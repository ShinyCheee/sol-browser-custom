using System.Runtime.InteropServices;
using System.Text;

namespace Browser.App;

/// <summary>
/// Garantit que seule la fenêtre principale de Sol apparaît dans la barre des tâches Windows et Alt+Tab.
/// Les fenêtres auxiliaires du moteur WebView2 (lecteur flottant « Image en incrustation », sélecteurs, bulles)
/// sont retirées de la barre des tâches dès leur création. Les commandes de partage d'écran restent accessibles.
/// </summary>
internal sealed class TaskbarSingleWindow : IDisposable
{
    private const uint EventObjectShow = 0x8002;
    private const uint EventObjectLocationChange = 0x800B;
    private const uint EventObjectNameChange = 0x800C;
    private const uint GaRoot = 2;
    private const uint GwOwner = 4;
    private const int GwlpHwndParent = -8;
    private const int GwlExStyle = -20;
    private const int WsPopup = unchecked((int)0x80000000);
    private const int WsExToolWindow = 0x00000080;
    private const int WsExAppWindow = 0x00040000;

    public static TaskbarSingleWindow? Shared { get; private set; }

    private readonly nint _mainHwnd;
    private readonly nint _hiddenOwner;
    private readonly Win32Interop.WinEventProc _proc;
    private readonly HashSet<uint> _watchedProcesses = new();
    private readonly List<nint> _hooks = new();
    private ITaskbarList? _taskbar;
    private bool _disposed;

    private TaskbarSingleWindow(nint mainHwnd)
    {
        _mainHwnd = mainHwnd;
        _hiddenOwner = Win32Interop.CreateWindowEx(WsExToolWindow, "STATIC", "", WsPopup, 0, 0, 0, 0, 0, 0, 0, 0);
        _proc = OnWinEvent;
        TryInitTaskbarList();
    }

    public static TaskbarSingleWindow Initialize(nint mainHwnd)
    {
        Shared?.Dispose();
        return Shared = new TaskbarSingleWindow(mainHwnd);
    }

    private void TryInitTaskbarList()
    {
        try
        {
            var type = Type.GetTypeFromCLSID(new Guid("56FDF344-FD6D-11d0-958A-006097C9A090"));
            if (type is null || Activator.CreateInstance(type) is not ITaskbarList list) return;
            if (list.HrInit() == 0) _taskbar = list;
            else Marshal.ReleaseComObject(list);
        }
        catch (COMException) { }
    }

    public void WatchProcess(uint processId)
    {
        if (_disposed || processId == 0 || !_watchedProcesses.Add(processId)) return;
        var hook = Win32Interop.SetWinEventHook(EventObjectShow, EventObjectNameChange, 0, _proc, processId, 0, 0);
        if (hook != 0) _hooks.Add(hook);
        Win32Interop.EnumWindows((hwnd, _) =>
        {
            Win32Interop.GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == processId) Inspect(hwnd);
            return true;
        }, 0);
    }

    public void HideFromTaskbar(nint hwnd)
    {
        if (_disposed || hwnd == 0 || hwnd == _mainHwnd || hwnd == _hiddenOwner) return;
        var ex = Win32Interop.GetWindowLong(hwnd, GwlExStyle);
        if ((ex & WsExAppWindow) != 0)
            Win32Interop.SetWindowLong(hwnd, GwlExStyle, ex & ~WsExAppWindow);
        // Rattachée à un propriétaire invisible, la fenêtre disparaît de la barre des tâches et d'Alt+Tab tout en gardant
        // son cadre natif redimensionnable et en restant visible même lorsque Sol est réduit.
        if (_hiddenOwner != 0 && Win32Interop.GetWindow(hwnd, GwOwner) == 0)
        {
            if (nint.Size == 8) Win32Interop.SetWindowLongPtr(hwnd, GwlpHwndParent, _hiddenOwner);
            else Win32Interop.SetWindowLong(hwnd, GwlpHwndParent, (int)_hiddenOwner);
        }
        try { _taskbar?.DeleteTab(hwnd); }
        catch (COMException) { }
    }

    private void OnWinEvent(nint hook, uint change, nint hwnd, int item, int child, uint thread, uint time)
    {
        if (_disposed || item != 0 || child != 0 || hwnd == 0 || hwnd == _mainHwnd || hwnd == _hiddenOwner) return;
        if (change is not (EventObjectShow or EventObjectLocationChange or EventObjectNameChange)) return;
        Inspect(hwnd);
    }

    private void Inspect(nint hwnd)
    {
        if (hwnd == 0 || hwnd == _mainHwnd || hwnd == _hiddenOwner || !Win32Interop.IsWindowVisible(hwnd)
            || Win32Interop.GetAncestor(hwnd, GaRoot) != hwnd) return;
        var classBuf = new StringBuilder(64);
        if (Win32Interop.GetClassName(hwnd, classBuf, classBuf.Capacity) == 0) return;
        var className = classBuf.ToString();
        if (className != "Chrome_WidgetWin_1" && className != "#32770") return;

        var ex = Win32Interop.GetWindowLong(hwnd, GwlExStyle);
        var owner = Win32Interop.GetWindow(hwnd, GwOwner);
        if (owner == 0 || (ex & WsExAppWindow) != 0)
            HideFromTaskbar(hwnd);

    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var hook in _hooks) Win32Interop.UnhookWinEvent(hook);
        _hooks.Clear();
        _watchedProcesses.Clear();
        if (_hiddenOwner != 0) Win32Interop.DestroyWindow(_hiddenOwner);
        if (_taskbar is not null)
        {
            Marshal.ReleaseComObject(_taskbar);
            _taskbar = null;
        }
        if (Shared == this) Shared = null;
    }

    [ComImport, Guid("56FDF342-FD6D-11d0-958A-006097C9A090"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList
    {
        [PreserveSig] int HrInit();
        [PreserveSig] int AddTab(nint hwnd);
        [PreserveSig] int DeleteTab(nint hwnd);
        [PreserveSig] int ActivateTab(nint hwnd);
        [PreserveSig] int SetActiveAlt(nint hwnd);
    }
}
