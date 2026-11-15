namespace Browser.Core;

public static class TabMemoryPolicy
{
    public static (TimeSpan SuspendAfter, TimeSpan DiscardAfter) ForMemory(long totalMb, long availableMb)
    {
        var pressured = totalMb > 0 && availableMb > 0 && availableMb < Math.Clamp(totalMb / 8, 256, 1024);
        return pressured ? (TimeSpan.FromSeconds(15), TimeSpan.FromMinutes(2)) : ForMemory(totalMb);
    }

    public static (TimeSpan SuspendAfter, TimeSpan DiscardAfter) ForMemory(long totalMb) => totalMb switch
    {
        > 0 and <= 4096 => (TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(10)),
        > 4096 and <= 8192 => (TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(15)),
        _ => (TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(30)),
    };
}
