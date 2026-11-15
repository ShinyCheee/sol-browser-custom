using Browser.App;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

static void Check(bool value, string reason) { if (!value) throw new Exception(reason); }

var failed = new CoreWebView2 { Suspend = () => throw new System.Runtime.InteropServices.COMException("fixture") };
new UiViewRest(new WebView2 { CoreWebView2 = failed }, () => false, "failure").Rest();
await Task.Delay(350);
Check(failed.MemoryUsageTargetLevel == CoreWebView2MemoryUsageTargetLevel.Low, "A valid hidden view must use low memory when native suspension throws");

var pending = new TaskCompletionSource<bool>();
var started = new TaskCompletionSource();
var visible = false;
var racing = new CoreWebView2 { Suspend = () => { started.SetResult(); return pending.Task; } };
var rest = new UiViewRest(new WebView2 { CoreWebView2 = racing }, () => visible, "race");
rest.Rest();
await started.Task.WaitAsync(TimeSpan.FromSeconds(3));
visible = true;
rest.Wake();
pending.SetException(new InvalidOperationException("completion after reopen"));
await Task.Delay(100);
Check(racing.MemoryUsageTargetLevel == CoreWebView2MemoryUsageTargetLevel.Normal, "A late suspension failure must not lower memory after the view reopens");
Check(racing.Resumes > 0, "Reopening must resume the view");
Console.WriteLine("PASS: suspension exceptions fall back to low memory and reopening stays awake");
