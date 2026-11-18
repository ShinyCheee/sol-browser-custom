import {DeleteObjectCommand, ListObjectsV2Command} from "@aws-sdk/client-s3";

export const BUCKET = "backups", MAX_BYTES = 256 * 1024 * 1024, MAX_PENDING = 5;
export const MAGIC = Buffer.from("SOLBACKUP1");
export const objectKey = (userId: string, id: string) => `${userId}/${id}.solbackup`;

const KEY_PATTERN = /^([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.solbackup$/i;
const CLEANUP_LOCK_ID = 1936682083;

// Les réservations expirées comptent dans le quota jusqu'à l'effacement effectif de l'objet.
export function backupStorage(pool: any, s3: any) {
  async function initialize() {
    await pool.query(`CREATE TABLE IF NOT EXISTS backups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, device text NOT NULL,
      bytes bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query("CREATE INDEX IF NOT EXISTS backups_user ON backups (user_id, created_at DESC)");
    // Stable backup identity; new ciphertext is staged separately before the pointer is switched atomically.
    await pool.query("ALTER TABLE backups ADD COLUMN IF NOT EXISTS object_id uuid");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS backups_object ON backups (object_id)");
    await pool.query(`CREATE TABLE IF NOT EXISTS backup_uploads (
      id uuid PRIMARY KEY, user_id text NOT NULL, bytes bigint NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour')`);
    await pool.query("CREATE INDEX IF NOT EXISTS backup_uploads_user ON backup_uploads (user_id)");
    await pool.query("CREATE INDEX IF NOT EXISTS backup_uploads_expires ON backup_uploads (expires_at)");
  }

  async function locked(userId: string, action: (client: any) => Promise<any>) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [userId]);
      const result = await action(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  async function reserve(userId: string, id: string, bytes: number) {
    return locked(userId, async db => {
      const {rows} = await db.query(
        "SELECT count(*)::int AS count, coalesce(sum(bytes), 0)::text AS bytes FROM backup_uploads WHERE user_id = $1",
        [userId],
      );
      if (rows[0].count >= MAX_PENDING || Number(rows[0].bytes) + bytes > MAX_BYTES) return false;
      await db.query("INSERT INTO backup_uploads (id, user_id, bytes) VALUES ($1, $2, $3)", [id, userId, bytes]);
      return true;
    });
  }

  async function release(userId: string, id: string) {
    await locked(userId, db =>
      db.query("DELETE FROM backup_uploads WHERE id = $1 AND user_id = $2", [id, userId]),
    );
  }

  async function pending(userId: string, id: string) {
    const {rows} = await pool.query(
      "SELECT bytes FROM backup_uploads WHERE id = $1 AND user_id = $2 AND expires_at > now()",
      [id, userId],
    );
    return rows[0];
  }

  async function register(userId: string, id: string, device: string, bytes: number, replace = false, stableId = false) {
    const saved = await locked(userId, async db => {
      const {rowCount} = await db.query(
        "DELETE FROM backup_uploads WHERE id = $1 AND user_id = $2 AND bytes = $3 AND expires_at > now() RETURNING id",
        [id, userId, bytes],
      );
      if (!rowCount) {
        const {rows} = await db.query(
          "SELECT id, bytes FROM backups WHERE user_id = $2 AND (id = $1 OR object_id = $1)",
          [id, userId],
        );
        if (rows[0]) return {id: rows[0].id, removed: []};
        throw new Error("upload reservation expired");
      }
      const previous = replace && stableId
        ? (await db.query(
            "SELECT id, coalesce(object_id, id) AS object_id FROM backups WHERE user_id = $1 AND lower(device) = lower($2) ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE",
            [userId, device],
          )).rows[0]
        : null;
      let backupId = id;
      let updated = false;
      if (previous) {
        const res = await db.query(
          "UPDATE backups SET object_id = $2, bytes = $3, created_at = now(), device = $4 WHERE id = $1 AND user_id = $5",
          [previous.id, id, bytes, device, userId],
        );
        if (res.rowCount === 1) {
          backupId = previous.id;
          updated = true;
        }
      }
      if (!updated) {
        await db.query(
          "INSERT INTO backups (id, user_id, device, bytes, object_id) VALUES ($1, $2, $3, $4, $1)",
          [id, userId, device, bytes],
        );
      }
      const replaced = replace
        ? (await db.query(
            "DELETE FROM backups WHERE user_id = $1 AND lower(device) = lower($2) AND id <> $3 RETURNING id, coalesce(object_id, id) AS object_id",
            [userId, device, backupId],
          )).rows
        : [];
      const stale = (await db.query(
        `DELETE FROM backups WHERE user_id = $1 AND id NOT IN
          (SELECT id FROM backups WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 5)
          RETURNING id, coalesce(object_id, id) AS object_id`,
        [userId],
      )).rows;
      // L'ancien objet d'une sauvegarde mise à jour sur place reste lisible > 1 h pour les téléchargements en cours.
      return {id: backupId, removed: [...replaced, ...stale]};
    });
    for (const row of saved.removed) {
      try {
        await s3.send(new DeleteObjectCommand({Bucket: BUCKET, Key: objectKey(userId, row.object_id)}));
      } catch {
        console.warn("backup.cleanup.deferred");
      }
    }
    return saved.id;
  }

  async function remove(userId: string, id: string) {
    const row = await locked(userId, async db => {
      const {rows} = await db.query(
        "DELETE FROM backups WHERE id = $1 AND user_id = $2 RETURNING coalesce(object_id, id) AS object_id",
        [id, userId],
      );
      return rows[0] ?? null;
    });
    if (!row) return false;
    try {
      await s3.send(new DeleteObjectCommand({Bucket: BUCKET, Key: objectKey(userId, row.object_id)}));
    } catch {
      console.warn("backup.cleanup.deferred");
    }
    return true;
  }

  async function cleanup() {
    const guard = await pool.connect();
    let acquired = false;
    try {
      const {rows: lockRows} = await guard.query(
        `SELECT pg_try_advisory_lock(${CLEANUP_LOCK_ID}) AS locked`,
      );
      acquired = lockRows[0]?.locked === true;
      if (!acquired) return false;

      // L'expiration dépasse largement les quinze minutes des adresses signées.
      while (true) {
        const {rows} = await pool.query("SELECT id, user_id FROM backup_uploads WHERE expires_at <= now() LIMIT 100");
        if (!rows.length) break;
        for (const row of rows) {
          await s3.send(new DeleteObjectCommand({Bucket: BUCKET, Key: objectKey(row.user_id, row.id)}));
          await pool.query("DELETE FROM backup_uploads WHERE id = $1 AND expires_at <= now()", [row.id]);
        }
      }

      // Inclut les anciens objets remplacés, les envois sans réservation et les suppressions différées.
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({Bucket: BUCKET, ContinuationToken: token}));
        const keys = (page.Contents ?? [])
          .filter((o: any) => o.Key && o.LastModified && o.LastModified.getTime() < Date.now() - 3600000)
          .map((o: any) => o.Key as string);
        if (keys.length) {
          const ids = [...new Set(
            keys.map((k: string) => KEY_PATTERN.exec(k)?.[2]?.toLowerCase()).filter((v: string | undefined): v is string => Boolean(v)),
          )];
          const kept = new Set<string>();
          if (ids.length) {
            const {rows} = await pool.query(
              `SELECT user_id, coalesce(object_id, id) AS object_id FROM backups
               WHERE object_id = ANY($1::uuid[]) OR id = ANY($1::uuid[])
               UNION ALL SELECT user_id, id AS object_id FROM backup_uploads
               WHERE id = ANY($1::uuid[])`,
              [ids],
            );
            for (const r of rows) kept.add(objectKey(r.user_id, String(r.object_id).toLowerCase()));
          }
          for (const key of keys) {
            if (!kept.has(key)) await s3.send(new DeleteObjectCommand({Bucket: BUCKET, Key: key}));
          }
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (page.IsTruncated && !token) throw new Error("storage listing missing continuation token");
      } while (token);
      return true;
    } finally {
      if (acquired) {
        await guard.query(`SELECT pg_advisory_unlock(${CLEANUP_LOCK_ID})`).catch(() => {});
      }
      guard.release();
    }
  }

  return {initialize, reserve, release, pending, register, remove, cleanup};
}
