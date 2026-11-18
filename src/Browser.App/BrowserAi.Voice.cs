using Browser.Core;
using System.Text.Json;

namespace Browser.App;

public sealed partial class BrowserController
{
    private SolVoiceSession? _voice;
    private bool _voiceOpen, _voiceTurn;
    private string? _voiceApproval;
    private object[] _voiceDevices = [];
    private Task? _voicePreparation;
    private string _voiceSettingsStamp = "";

    private object VoiceState() => new
    {
        available = SolAiPermissions.VoiceAvailable, supported = SolVoiceWorker.Available,
        open = _voiceOpen && AiReady, provider = "parakeet",
        mode = _voiceTurn && _chatTrace?.Pending is not null && _voice?.Mode != "listening" ? "approval" : _voiceStarting && _voice?.Mode == "idle" ? "checking" : _voice?.Mode ?? "idle",
        level = _voice?.Level ?? 0, text = _voice?.Text ?? "", error = _voice?.Error,
        ready = _voice?.AssetsReady ?? false, progress = _voice?.Progress ?? 0,
        conversation = _voice?.Conversation ?? false, readAloud = _voice?.ReadAloud ?? _settings.SolVoiceReadAloud,
        device = _voice?.Device ?? _settings.SolVoiceDevice, devices = _voiceDevices, seconds = _voice?.Seconds ?? 0,
        downloadMiB = (int)Math.Ceiling(VoiceAssetStore.ForLanguage(Language.Current).Sum(a => a.Bytes) / 1048576d),
    };
    private void PublishVoice()
    {
        if (!_closingWindow && Chat is not null) Chat.Post(JsonSerializer.Serialize(new { voice = VoiceState() }));
        var stamp = $"{_voice?.Mode}|{_voice?.AssetsReady}|{Math.Round((_voice?.Progress ?? 0) * 100)}|{_voice?.Conversation}|{_voice?.ReadAloud}|{_voice?.Device}|{_voice?.Error}";
        if (_settingsOpen && !_closingWindow && stamp != _voiceSettingsStamp)
        { _voiceSettingsStamp = stamp; _popup.Post(SettingsJson()); }
    }
    private bool VoiceCommand(Command c)
    {
        if (!c.Type.StartsWith("voice.", StringComparison.Ordinal)) return false;
        if (c.Type == "voice.close") { CloseVoice(); return true; }
        if (c.Type == "voice.toggle") { _ = ToggleVoiceAsync(); return true; }
        if (!SolAiPermissions.VoiceAvailable) { CloseVoice(); return true; }
        if (!AiReady) return true;
        if (c.Type == "voice.configure") { EnsureVoice(); PublishVoice(); return true; }
        if (c.Type == "voice.settings")
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:privacy-microphone") { UseShellExecute = true });
            return true;
        }
        if (c.Type == "voice.stop") { if (_voiceTurn) CancelChat(); _voiceTurn = false; _voiceApproval = null; _voice?.Stop(); PublishVoice(); return true; }
        if (c.Type == "voice.cancelInstall") { _voice?.CancelInstall(); return true; }
        if (c.Type == "voice.install") { if (SolVoiceWorker.Available) _ = _voice?.InstallAsync(); return true; }
        if (c.Type == "voice.finish") { _voice?.FinishCapture(); return true; }
        if (c.Type == "voice.interrupt") { _ = InterruptVoiceAsync(); return true; }
        if (c.Type == "voice.options")
        {
            if (c.Id == "readAloud" && c.Index is 0 or 1)
            {
                _settings.SolVoiceReadAloud = c.Index == 1;
                if (_voice is not null) _voice.ReadAloud = _settings.SolVoiceReadAloud;
                JsonFileStore.Save(AppPaths.Settings, _settings);
            }
            if (c.Id == "device" && c.Index is >= -1 and < 100)
            {
                _settings.SolVoiceDevice = c.Index.Value;
                if (_voice is not null) _ = _voice.ChangeDeviceAsync(c.Index.Value, Language.Current);
                JsonFileStore.Save(AppPaths.Settings, _settings);
            }
            PublishVoice(); return true;
        }
        if (c.Type is not ("voice.open" or "voice.listen")) return true;
        if (Chat?.IsOpen != true) return true;
        _voiceOpen = true;
        EnsureVoice();
        if (c.Type == "voice.listen")
        {
            if (_chatBusy && _chatTrace?.Pending is null) return true;
            if (!_chatBusy) _voiceTurn = false;
            _voiceApproval = _chatTrace?.Pending?.Id;
            if (SolVoiceWorker.Available) _ = ListenInCurrentLanguageAsync();
        }
        PublishVoice(); return true;
    }
    private async Task ListenInCurrentLanguageAsync()
    {
        if (_voice is not { } voice) return;
        if (voice.CheckedLanguage != Language.Current)
        {
            _voicePreparation = voice.CheckAssetsAsync(Language.Current);
            await _voicePreparation;
        }
        if (_voice == voice && _voiceOpen && AiReady && Chat?.IsOpen == true && voice.AssetsReady)
            await voice.ListenAsync(Language.Current);
    }
    private void FinishVoiceTurn(bool success)
    {
        if (!_voiceTurn || !_voiceOpen || !AiReady || Chat?.IsOpen != true) return;
        _voiceTurn = false;
        if (_voice is { } voice) _ = voice.FinishResponseAsync(success);
        PublishVoice();
    }
    private void SpeakVoiceApproval(string label)
    {
        if (_voiceOpen && _voiceTurn && AiReady)
            _voice?.SpeakNotice(label + ". " + T("Consultez les détails et confirmez l’action dans la discussion.",
                "Review the details and confirm the action in the conversation."));
    }
    private async Task InterruptVoiceAsync()
    {
        var voice = _voice;
        _voiceTurn = false; _voiceApproval = null; CancelChat();
        if (voice is not null) await voice.InterruptAndListenAsync(Language.Current, () => _chatBusy,
            () => _voiceOpen && AiReady && _voice == voice && Chat?.IsOpen == true && SolVoiceWorker.Available);
    }
    private void CloseVoice(bool release = true)
    {
        DebugLog.Write("voice.close " + release);
        _voiceOpen = false; _voiceTurn = false; _voiceApproval = null;
        _voiceActivation++; _voiceStarting = false;
        if (release) { _voicePreparation = null; _voice?.Dispose(); _voice = null; }
        else _voice?.Stop();
        DebugLog.Write("voice.closed");
        PublishVoice();
    }
}
