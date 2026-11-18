using System.Runtime.InteropServices;

namespace Browser.App;

internal static class SystemMemory
{
    public static (long Total, long Available, long Commit) Read()
    {
        var status = new Win32Interop.MemoryStatus { Length = (uint)Marshal.SizeOf<Win32Interop.MemoryStatus>() };
        return Win32Interop.GlobalMemoryStatusEx(ref status) ? ((long)(status.TotalPhysical / (1024 * 1024)),
            (long)(status.AvailablePhysical / (1024 * 1024)), (long)(status.AvailablePageFile / (1024 * 1024))) : (0, 0, 0);
    }
}
