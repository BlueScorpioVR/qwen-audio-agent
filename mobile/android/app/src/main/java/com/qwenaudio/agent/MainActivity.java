package com.qwenaudio.agent;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoiceKeepAlivePlugin.class);
        registerPlugin(MediaAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewRunning();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewRunning();
    }

    @Override
    public void onDestroy() {
        if (isFinishing()) {
            stopService(new Intent(this, KeepAliveService.class));
        }
        super.onDestroy();
    }

    /**
     * While the foreground service runs, undo the WebView pause that normally
     * follows a locked screen or backgrounded activity, so JavaScript timers,
     * the gateway socket and microphone capture keep going.
     */
    private void keepWebViewRunning() {
        if (!KeepAliveService.isRunning() || getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.onResume();
        webView.resumeTimers();
        webView.dispatchWindowVisibilityChanged(View.VISIBLE);
    }
}
