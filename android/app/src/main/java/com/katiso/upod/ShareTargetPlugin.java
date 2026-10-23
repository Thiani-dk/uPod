package com.katiso.upod;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Makes uPod an entry in the system share sheet, so a link shared from
// YouTube/Instagram/a browser lands here instead of having to be pasted.
// The manifest side is one ACTION_SEND + text/plain filter on
// MainActivity — the same registration Snaptube uses (a single
// .activity.ActionSendDispatchActivity with that filter); there is no
// privileged API involved, only the public share-sheet contract.
//
// Two arrival paths have to be covered, because they differ in whether
// any JS exists yet to hear about it:
//
//   cold start  — the share launched the process. load() runs long
//                 before the webview has evaluated main.jsx, so an
//                 event here would be shouted into an empty room. The
//                 URL is parked and the JS side collects it with
//                 getPending() once it has mounted.
//   warm start  — MainActivity is launchMode="singleTask", so a share
//                 into an already-running uPod is delivered to
//                 onNewIntent instead. There a listener does exist, so
//                 it is emitted as an event (and still parked, in case
//                 the webview was torn down while backgrounded).
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    private static final String EVENT_SHARED = "shared";

    // What YouTube and Instagram actually put in EXTRA_TEXT is a human
    // sentence with the link somewhere inside it ("Watch <title>
    // https://youtu.be/xyz"), not a bare URL — so the first http(s)
    // token is pulled out rather than trusting the whole extra. Stops at
    // whitespace and at the quote/bracket characters that commonly fence
    // a URL in prose, so trailing punctuation doesn't ride along.
    private static final Pattern URL_IN_TEXT = Pattern.compile("https?://[^\\s<>\"']+");

    private String pendingUrl;

    @Override
    public void load() {
        pendingUrl = extractUrl(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        String url = extractUrl(intent);
        if (url == null) return;
        pendingUrl = url;
        JSObject payload = new JSObject();
        payload.put("url", url);
        notifyListeners(EVENT_SHARED, payload);
    }

    // Hands over (and clears) whatever share is waiting. Clearing on read
    // is what keeps a share one-shot: without it, anything that re-runs
    // load() or re-reads the launch intent — a low-memory process restart
    // while uPod is still the foreground task, say — would offer to
    // download the same link a second time.
    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("url", pendingUrl);
        pendingUrl = null;
        call.resolve(ret);
    }

    // Returns the shared URL, or null if this intent isn't a text share
    // or carries no URL at all. The extra is also stripped from the
    // intent itself, so the same share can't be re-read from the
    // activity's retained launch intent later.
    private String extractUrl(Intent intent) {
        if (intent == null) return null;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return null;

        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) {
            // Some apps share a link as the subject line only.
            text = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        }
        if (text == null) return null;

        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_SUBJECT);

        Matcher m = URL_IN_TEXT.matcher(text);
        return m.find() ? m.group() : null;
    }
}
