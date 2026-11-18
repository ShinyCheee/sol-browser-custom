using System.Net;
using System.Text;
using Browser.Core;

namespace Browser.Core.Tests;

public sealed class CloudAccountTests
{
    [Fact]
    public async Task Signed_url_must_be_https_or_loopback_and_malformed_json_becomes_server_error()
    {
        Func<HttpRequestMessage, HttpResponseMessage> handler = _ => new(HttpStatusCode.OK);
        using var http = new HttpClient(new StubHandler(r => handler(r)));
        var cloud = new CloudAccount(http, "https://auth.example", "https://api.example");

        handler = r => r.RequestUri!.AbsolutePath.EndsWith("/token")
            ? Json("""{"token":"jwt"}""")
            : Json("""{"url":"http://insecure.example/backup.bin"}""");
        var insecure = await Assert.ThrowsAsync<CloudException>(() => cloud.DownloadAsync("cookie=1", "b1"));
        Assert.Equal("server", insecure.Code);

        handler = r => r.RequestUri!.AbsolutePath.EndsWith("/token")
            ? Json("""{"token":"jwt"}""")
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{ broken json", Encoding.UTF8, "application/json") };
        var malformed = await Assert.ThrowsAsync<CloudException>(() => cloud.ListAsync("cookie=1"));
        Assert.Equal("server", malformed.Code);

        handler = r =>
        {
            if (r.RequestUri!.AbsolutePath.EndsWith("/token")) return Json("""{"token":"jwt"}""");
            if (r.RequestUri.Host == "api.example") return Json("""{"url":"https://storage.example/backup.bin"}""");
            var resp = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1, 2, 3]) };
            resp.Content.Headers.ContentLength = CloudAccount.MaxBytes + 1;
            return resp;
        };
        var oversized = await Assert.ThrowsAsync<CloudException>(() => cloud.DownloadAsync("cookie=1", "b1"));
        Assert.Equal("too-large", oversized.Code);
    }

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }
}
