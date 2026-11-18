using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class UiBridge
{
    // Lit les couleurs de la page active : son fond, et sa couleur d'accent (celle qui fait son identité).
    private const string ThemeProbeScript = """
        (() => {
          if (document.hidden) return null;
          if (location.href === 'about:blank' && !document.documentElement.hasAttribute('data-nav-error')) {
            document.documentElement.style.background = '#eef0e2';
            return { bg: 'rgb(238, 240, 226)', dark: false, accent: null };
          }
          const parse = s => {
            const m = s && s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
          };
          const ctx = window.__solColorCtx || (window.__solColorCtx = (() => {
            const c = document.createElement('canvas'); c.width = c.height = 1;
            return c.getContext('2d', { willReadFrequently: true });
          })());
          const resolve = css => {
            if (!css || !ctx || !CSS.supports('color', css)) return null;
            const rgb = parse(css);
            if (rgb) return rgb;
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
            return [r, g, b, a / 255];
          };
          const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const sat = ([r, g, b]) => { const max = Math.max(r, g, b), min = Math.min(r, g, b); return max === 0 ? 0 : (max - min) / max; };

          if (document.readyState === 'loading') return null;
          const els = [];
          for (const x of [window.innerWidth * 0.5, window.innerWidth * 0.25, 24]) {
            let el = document.elementFromPoint(x, 12);
            while (el) { els.push(el); el = el.parentElement; }
          }
          els.push(document.querySelector('ytd-app'), document.querySelector('main'), document.body, document.documentElement);
          let bg = [255, 255, 255];
          for (const el of els) {
            if (!el) continue;
            const c = resolve(getComputedStyle(el).backgroundColor);
            if (c && c[3] > 0.15) { bg = c.slice(0, 3); break; }
          }

          const votes = new Map();
          const vote = (c, weight) => {
            if (!c || c[3] < 0.5 || sat(c) < 0.35 || lum(c) < 0.12 || lum(c) > 0.92) return;
            const key = c.slice(0, 3).map(v => Math.round(v / 24) * 24).join(',');
            const entry = votes.get(key) || { c: c.slice(0, 3), w: 0 };
            entry.w += weight * (0.5 + sat(c));
            votes.set(key, entry);
          };
          const meta = document.querySelector('meta[name="theme-color"]');
          if (meta) vote(resolve(meta.content), 12);
          if (sat(bg) >= 0.35) vote([...bg, 1], 10);
          const sample = (selector, weight, limit) => {
            let n = 0;
            for (const el of document.querySelectorAll(selector)) {
              if (n >= limit) break;
              const box = el.getBoundingClientRect();
              if (box.width < 8 || box.height < 8 || box.bottom < 0 || box.top > innerHeight) continue;
              n++;
              const style = getComputedStyle(el);
              vote(resolve(style.backgroundColor), weight * Math.min(3, (box.width * box.height) / 4000 + 0.5));
              vote(resolve(style.color), weight * 0.4);
              if (el instanceof SVGElement) vote(resolve(style.fill), weight * 0.6);
            }
          };
          sample('header, nav, [role="banner"]', 3, 6);
          sample('button, [role="button"], input[type="submit"], a[class*="btn"], a[class*="button"]', 2, 24);
          sample('header svg, nav svg, [class*="logo"] svg, [class*="logo"]', 2, 8);
          sample('a[href]', 1, 30);
          let best = null;
          for (const entry of votes.values()) if (!best || entry.w > best.w) best = entry;

          const rgb = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
          return { bg: rgb(bg), dark: lum(bg) < 0.42, accent: best ? rgb(best.c) : null, sx: scrollX, sy: scrollY, vw: innerWidth, vh: innerHeight };
        })()
        """;

    private static bool NeedsPageSampling =>
        Settings is not { Theme: "light" or "dark", TintTopbar: false, TintSidebar: false, TintMenus: false, TintBackground: false };

    private int _themeGeneration;
    private async void ProbeActiveThemeAsync(bool withDelays)
    {
        var generation = ++_themeGeneration;
        await SampleOnceAsync();
        if (!withDelays || !NeedsPageSampling) return;
        await Task.Delay(350);
        if (generation != _themeGeneration) return;
        await SampleOnceAsync();
        await Task.Delay(800);
        if (generation != _themeGeneration) return;
        await SampleOnceAsync();
    }

    private int _themeRequest;
    private async Task SampleOnceAsync()
    {
        if (pages is null || _activeId is null || pages.CoreOf(_activeId) is not { } core) return;
        var id = _activeId;
        var source = core.Source;
        if (source == Settings.DefaultHomePage)
        {
            PublishTheme();
            if (s_lastProbe is var (startBg, _, _) && Rgb(startBg) is var (sr, sg, sb))
                PublishPageColor(sr, sg, sb);
            return;
        }
        if (!NeedsPageSampling)
        {
            var fixedDark = Settings?.Theme == "dark";
            var fixedBg = fixedDark ? "rgb(28, 28, 30)" : "rgb(238, 240, 226)";
            s_lastProbe = (fixedBg, fixedDark, null);
            PublishPageColor(fixedDark ? (byte)28 : (byte)238, fixedDark ? (byte)28 : (byte)240, fixedDark ? (byte)30 : (byte)226);
            PublishTheme();
            return;
        }
        var request = ++_themeRequest;
        try
        {
            var raw = await core.ExecuteScriptAsync(ThemeProbeScript);
            if (request != _themeRequest || _activeId != id || core.Source != source || pages.CoreOf(id) != core) return;
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return;
            var bg = doc.RootElement.GetProperty("bg").GetString() ?? "rgb(245, 246, 238)";
            var dark = doc.RootElement.GetProperty("dark").GetBoolean();
            var edge = await EdgeColorAsync(core, id, source, bg, doc.RootElement);
            if (request != _themeRequest || _activeId != id || core.Source != source || pages.CoreOf(id) != core) return;
            if (edge is not null && Rgb(edge) is var (er, eg, eb))
            {
                bg = edge;
                dark = (0.299 * er + 0.587 * eg + 0.114 * eb) / 255 < 0.42;
            }
            if (Rgb(bg) is var (r, g, b)) PublishPageColor(r, g, b);
            var accent = doc.RootElement.TryGetProperty("accent", out var accentValue) && accentValue.ValueKind == JsonValueKind.String ? accentValue.GetString() : null;
            s_lastProbe = (bg, dark, accent);
            PublishTheme();
        }
        catch (Exception) { }
    }
}
