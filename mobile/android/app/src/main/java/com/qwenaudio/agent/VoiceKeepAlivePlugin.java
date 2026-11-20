package com.qwenaudio.agent;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for KeepAliveService plus a native idle chime that still plays
 * when the WebView's own audio output is throttled with the screen off.
 */
@CapacitorPlugin(name = "VoiceKeepAlive")
public class VoiceKeepAlivePlugin extends Plugin {
    private static final int SAMPLE_RATE = 24000;

    @PluginMethod
    public void start(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        // A microphone-type foreground service may only start once the runtime
        // microphone permission exists (Android 14+ throws otherwise).
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            result.put("started", false);
            result.put("reason", "microphone_permission");
            call.resolve(result);
            return;
        }
        requestNotificationPermission();
        try {
            ContextCompat.startForegroundService(context, serviceIntent(call.getString("text")));
            result.put("started", true);
        } catch (RuntimeException error) {
            result.put("started", false);
            result.put("reason", String.valueOf(error.getMessage()));
        }
        call.resolve(result);
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (KeepAliveService.isRunning()) {
            try {
                ContextCompat.startForegroundService(getContext(), serviceIntent(call.getString("text")));
            } catch (RuntimeException ignored) {
                // The next start() will retry.
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), KeepAliveService.class));
        call.resolve();
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", KeepAliveService.isRunning());
        call.resolve(result);
    }

    @PluginMethod
    public void playChime(PluginCall call) {
        new Thread(VoiceKeepAlivePlugin::playTwoNoteChime, "qwaudio-chime").start();
        call.resolve();
    }

    private Intent serviceIntent(String text) {
        Intent intent = new Intent(getContext(), KeepAliveService.class)
            .setAction(KeepAliveService.ACTION_START);
        if (text != null) intent.putExtra(KeepAliveService.EXTRA_TEXT, text);
        return intent;
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (getActivity() == null) return;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) return;
        ActivityCompat.requestPermissions(
            getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 4108);
    }

    /** Falling G5 -> C5, matching the Web Audio chime. */
    private static void playTwoNoteChime() {
        double[][] notes = {{783.99, 0.0, 0.34}, {523.25, 0.22, 0.34}};
        int total = (int) (SAMPLE_RATE * 0.62);
        short[] pcm = new short[total];
        for (double[] note : notes) {
            int from = (int) (note[1] * SAMPLE_RATE);
            int length = (int) (note[2] * SAMPLE_RATE);
            for (int i = 0; i < length && from + i < total; i++) {
                double t = (double) i / SAMPLE_RATE;
                double attack = Math.min(1.0, t / 0.03);
                double decay = Math.exp(-t * 9.0);
                double sample = Math.sin(2 * Math.PI * note[0] * t) * attack * decay * 0.55;
                int mixed = pcm[from + i] + (int) (sample * Short.MAX_VALUE);
                pcm[from + i] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, mixed));
            }
        }
        AudioTrack track = null;
        try {
            track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build())
                .setBufferSizeInBytes(pcm.length * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build();
            track.write(pcm, 0, pcm.length);
            track.play();
            Thread.sleep(800);
        } catch (RuntimeException | InterruptedException ignored) {
            // A missed chime must never crash the app.
        } finally {
            if (track != null) track.release();
        }
    }
}
