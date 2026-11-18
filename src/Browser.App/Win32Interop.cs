using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Browser.App;

/// <summary>Déclarations Win32 partagées par la fenêtre, les poignées, la capture, les curseurs et le moteur vocal.</summary>
internal static class Win32Interop
{
    public const uint JobLimitKillOnJobClose = 0x00002000;
    public const int JobExtendedLimitInfoClass = 9;

    [StructLayout(LayoutKind.Sequential)]
    public struct WinPoint { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct WinRect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct BitmapInfoHeader
    {
        public uint Size;
        public int Width, Height;
        public ushort Planes, BitCount;
        public uint Compression, SizeImage;
        public int XPelsPerMeter, YPelsPerMeter;
        public uint ClrUsed, ClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MemoryStatus
    {
        public uint Length, Load;
        public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile, TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JobBasicLimit
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JobExtendedLimit
    {
        public JobBasicLimit Basic;
        public IoCounters Io;
        public nuint ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    public delegate nint SubclassProc(nint hwnd, uint msg, nint wParam, nint lParam, nuint id, nuint data);
    public delegate void WinEventProc(nint hook, uint change, nint hwnd, int item, int child, uint thread, uint time);
    public delegate bool EnumWindowsProc(nint hwnd, nint lParam);

    [DllImport("user32.dll", EntryPoint = "MessageBoxW", CharSet = CharSet.Unicode)]
    public static extern int MessageBox(nint window, string text, string caption, uint type);

    [DllImport("user32.dll")] public static extern bool GetClientRect(nint hwnd, out WinRect rect);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(nint hwnd, out WinRect rect);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out WinPoint point);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(nint hwnd, ref WinPoint point);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(nint hwnd, ref WinPoint point);
    [DllImport("user32.dll")] public static extern nint WindowFromPoint(WinPoint point);
    [DllImport("user32.dll")] public static extern nint GetAncestor(nint hwnd, uint flags);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern bool ShowWindow(nint hwnd, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint processId);
    [DllImport("user32.dll", EntryPoint = "SendMessageW")] public static extern nint SendMessage(nint hwnd, uint msg, nint wParam, nint lParam);
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(nint hwnd, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(nint hwnd, int id);
    [DllImport("user32.dll")] public static extern bool PrintWindow(nint hwnd, nint dc, uint flags);
    [DllImport("user32.dll", SetLastError = true)] public static extern nint CreateCursor(nint instance, int x, int y, int width, int height, byte[] andMask, byte[] xorMask);
    [DllImport("user32.dll")] public static extern bool DestroyCursor(nint cursor);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern nint SetWindowLongPtr(nint hwnd, int index, nint value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] public static extern int SetWindowLong(nint hwnd, int index, int value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(nint hwnd, int index);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(nint hwnd, nint after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern nint SetWinEventHook(uint first, uint last, nint module, WinEventProc proc, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(nint hook);
    [DllImport("user32.dll")] public static extern nint GetWindow(nint hwnd, uint relation);
    [DllImport("user32.dll", EntryPoint = "GetWindowTextLengthW", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(nint hwnd);
    [DllImport("user32.dll", EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode)] public static extern int GetClassName(nint hwnd, StringBuilder name, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, nint lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(nint hwnd, out uint processId);
    [DllImport("user32.dll", EntryPoint = "CreateWindowExW", CharSet = CharSet.Unicode)]
    public static extern nint CreateWindowEx(int exStyle, string className, string title, int style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint param);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(nint hwnd);

    [DllImport("comctl32.dll")] public static extern bool SetWindowSubclass(nint hwnd, SubclassProc proc, nuint id, nuint data);
    [DllImport("comctl32.dll")] public static extern nint DefSubclassProc(nint hwnd, uint msg, nint wParam, nint lParam);

    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(nint hwnd, int attribute, ref int value, int size);

    [DllImport("gdi32.dll")] public static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32.dll")] public static extern nint CreateDIBSection(nint dc, ref BitmapInfoHeader info, uint usage, out nint bits, nint section, uint offset);
    [DllImport("gdi32.dll")] public static extern nint SelectObject(nint dc, nint item);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(nint item);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(nint dc);

    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
    [DllImport("kernel32.dll")] public static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint processId);
    [DllImport("kernel32.dll", EntryPoint = "CreateJobObjectW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern nint CreateJobObject(nint attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetInformationJobObject(nint job, int infoClass, ref JobExtendedLimit info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AssignProcessToJobObject(nint job, nint process);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(nint handle);

    [DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, nint item1, nint item2);
}
