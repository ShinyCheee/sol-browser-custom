using System.Text.Json;

namespace Browser.Core;

/// <summary>Une plage d'octets d'un fichier : <see cref="Position"/> avance de <see cref="Start"/> vers <see cref="End"/> (inclus).</summary>
public sealed class Segment
{
    public long Start { get; set; }
    public long End { get; set; }
    public long Position { get; set; }
    public bool Taken { get; set; }
    public long Remaining => Math.Max(0, End - Position + 1);
}

/// <summary>
/// Découpage d'un fichier en plages téléchargées en parallèle, comme IDM : une connexion qui finit la sienne reprend la
/// moitié de la plus grosse plage restante. Non thread-safe : l'appelant verrouille l'instance.
/// </summary>
public sealed class SegmentPlan
{
    public long Total { get; init; }
    public string? Validator { get; init; }
    public List<Segment> Segments { get; init; } = [];

    public long Done => Segments.Sum(s => Math.Min(s.Position, s.End + 1) - s.Start);
    public bool Complete => Segments.All(s => s.Remaining == 0);

    public static SegmentPlan Split(long total, int parts, string? validator)
    {
        if (total <= 0) throw new ArgumentOutOfRangeException(nameof(total));
        parts = (int)Math.Clamp(parts, 1, Math.Max(1, total));
        var plan = new SegmentPlan { Total = total, Validator = validator };
        var size = total / parts;
        for (var i = 0; i < parts; i++)
        {
            var start = i * size;
            var end = i == parts - 1 ? total - 1 : start + size - 1;
            plan.Segments.Add(new Segment { Start = start, End = end, Position = start });
        }
        return plan;
    }

    /// <summary>Prochaine plage pour une connexion libre : une plage en attente, sinon la moitié de la plus grosse plage
    /// en cours, si elle dépasse deux fois <paramref name="minimum"/>. Null quand il n'y a plus rien à partager.</summary>
    public Segment? Next(long minimum)
    {
        if (Segments.FirstOrDefault(s => !s.Taken && s.Remaining > 0) is { } waiting) { waiting.Taken = true; return waiting; }
        var largest = Segments.Where(s => s.Taken).MaxBy(s => s.Remaining);
        if (largest is null || largest.Remaining < 2 * minimum) return null;
        var middle = largest.Position + largest.Remaining / 2;
        var stolen = new Segment { Start = middle, End = largest.End, Position = middle, Taken = true };
        largest.End = middle - 1;
        Segments.Add(stolen);
        return stolen;
    }

    /// <summary>Réserve jusqu'à <paramref name="count"/> octets de la plage : la position d'écriture et le nombre accordé.</summary>
    public static (long Offset, int Count) Reserve(Segment segment, int count)
    {
        var granted = (int)Math.Min(count, segment.Remaining);
        var offset = segment.Position;
        segment.Position += granted;
        return (offset, granted);
    }

    public string ToJson() => JsonSerializer.Serialize(new Saved(Total, Validator, Segments.Select(s => new[] { s.Start, s.End, s.Position }).ToArray()));

    /// <summary>Plan enregistré lors d'une pause ; null s'il est illisible ou incohérent.</summary>
    public static SegmentPlan? FromJson(string json)
    {
        try
        {
            var saved = JsonSerializer.Deserialize<Saved>(json);
            if (saved is null || saved.Total <= 0 || saved.Ranges is null) return null;
            var plan = new SegmentPlan { Total = saved.Total, Validator = saved.Validator };
            foreach (var r in saved.Ranges)
            {
                if (r.Length != 3 || r[0] < 0 || r[1] >= saved.Total || r[0] > r[1] + 1 || r[2] < r[0] || r[2] > r[1] + 1) return null;
                plan.Segments.Add(new Segment { Start = r[0], End = r[1], Position = r[2] });
            }
            return plan.Segments.Count > 0 ? plan : null;
        }
        catch (JsonException) { return null; }
    }

    private sealed record Saved(long Total, string? Validator, long[][] Ranges);
}
