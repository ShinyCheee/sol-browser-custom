using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    private int _voiceActivation;
    private bool _voiceStarting, _voiceOpenedChat;
    private bool _voiceSetupOpen;
    private void EnsureVoice()
    {
        if (_voice is not null)
        {
            if (SolVoiceWorker.Available && !_voice.Installing && _voice.CheckedLanguage != Language.Current)
                _voicePreparation = _voice.CheckAssetsAsync(Language.Current);
            return;
        }
        var voice = _voice = new SolVoiceSession(action => _window.DispatcherQueue.TryEnqueue(() => action()))
        {
            ReadAloud = _settings.SolVoiceReadAloud,
            Device = _settings.SolVoiceDevice,
        };
        _voiceDevices = SolVoiceCapture.Devices();
        voice.Changed += PublishVoice;
        voice.ContinueListening += () =>
        {
            if (AiReady && _voiceOpen && _voice == voice && !_chatBusy && _chatTrace?.Pending is null && Chat?.IsOpen == true) _ = voice.ListenAsync(Language.Current);
        };
        voice.Recognized += text =>
        {
            if (!AiReady || !_voiceOpen || _voice != voice || Chat?.IsOpen != true) return;
            if (_voiceApproval is { } approval)
            {
                _voiceApproval = null;
                if (_chatTrace?.Pending is not { } pending || pending.Id != approval) return;
                if (SolVoiceText.Approval(text) is { } allow) AnswerApproval(new("ai.approve", Id: approval, Index: allow ? 1 : 0));
                else voice.Stop();
                PublishVoice(); return;
            }
            if (_chatBusy) return;
            _voiceTurn = true; _ = SendChatAsync(text);
        };
        if (SolVoiceWorker.Available) _voicePreparation = voice.CheckAssetsAsync(Language.Current);
    }
    private void OnVoiceLanguageChanged()
    {
        if (_voice is { Installing: false } voice && SolVoiceWorker.Available && voice.CheckedLanguage != Language.Current)
            _voicePreparation = voice.CheckAssetsAsync(Language.Current);
    }
    private async Task ToggleVoiceAsync()
    {
        if (_voiceOpen || _voiceStarting || _voiceSetupOpen && _settingsOpen && _voice?.AssetsReady != true)
        {
            var hide = _voiceOpenedChat;
            if (_voiceTurn) CancelChat();
            if (_voiceSetupOpen && _settingsOpen) HidePopup();
            _voiceSetupOpen = false;
            CloseVoice(release: false);
            if (hide) Chat?.Hide();
            _voiceOpenedChat = false;
            PublishChat(); Refresh(); return;
        }
        if (PrivateActive || Chat is null || !SolAiPermissions.VoiceAvailable) return;
        if (_voiceSetupOpen && _settingsOpen) HidePopup();
        _voiceSetupOpen = false;
        _voiceStarting = true;
        var activation = ++_voiceActivation;
        _voiceOpenedChat = !Chat.IsOpen;
        await Chat.ShowAsync();
        if (activation != _voiceActivation || _closingWindow || Chat?.IsOpen != true)
        { if (activation == _voiceActivation) _voiceStarting = false; return; }
        if (!AiReady) { _voiceStarting = false; PublishChat(); Refresh(); return; }
        EnsureVoice();
        var voice = _voice!;
        _voiceOpen = true;
        PublishChat(); Refresh();
        if (_voicePreparation is { } preparation) await preparation;
        if (activation != _voiceActivation || _voice != voice || !AiReady || Chat.IsOpen != true)
        { if (activation == _voiceActivation) _voiceStarting = false; return; }
        _voiceStarting = false;
        if (!SolVoiceWorker.Available || !voice.AssetsReady)
        {
            _voiceOpen = false;
            PublishChat();
            HidePopup(); _settingsOpen = true;
            _voiceSetupOpen = true;
            _popup.ShowCentered(420, SettingsJson("about"));
            Refresh(); return;
        }
        _voiceOpen = true;
        PublishChat(); Refresh();
        if (_chatBusy && _chatTrace?.Pending is null) { _voiceTurn = true; voice.BeginResponse(); }
        else VoiceCommand(new("voice.listen"));
    }
}
