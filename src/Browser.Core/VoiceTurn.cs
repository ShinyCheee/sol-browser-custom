namespace Browser.Core;

public sealed class VoiceTurn
{
    public int Generation { get; private set; }
    public bool Active { get; private set; }
    public bool Conversation { get; private set; }
    public bool ReadAloud { get; private set; }
    public int Begin(bool conversation, bool readAloud)
    {
        Generation++; Active = true; Conversation = conversation; ReadAloud = readAloud;
        return Generation;
    }
    public bool Accepts(int generation) => Active && generation == Generation;
    public bool Complete(int generation, bool success)
    {
        if (!Accepts(generation)) return false;
        if (!success) { Stop(); return false; }
        return Conversation;
    }
    public void Stop() { Generation++; Active = false; }
}
