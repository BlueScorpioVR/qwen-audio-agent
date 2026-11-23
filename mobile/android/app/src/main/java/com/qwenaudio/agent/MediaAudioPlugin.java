package com.qwenaudio.agent;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the app on media audio routing while voice is active.
 *
 * WebView capture with echo cancellation puts Android in MODE_IN_COMMUNICATION,
 * which routes the assistant's speech over the headset's SCO call channel (or
 * the earpiece) and takes it off the media volume. Re-asserting media routing
 * keeps playback on the normal media path, so a Bluetooth headset plays it
 * over A2DP and the hardware volume keys control it.
 */
@CapacitorPlugin(name = "MediaAudio")
public class MediaAudioPlugin extends Plugin {
    private static final long REASSERT_MS = 700;

    private AudioManager audioManager;
    private Handler handler;
    private AudioFocusRequest focusRequest;
    private volatile boolean active;
    // 0 = phone microphone with media output; 1 = Bluetooth headset mic (SCO).
    private int inputRoute = 0;

    private final Runnable reassert = new Runnable() {
        @Override
        public void run() {
            if (!active) return;
            enforceMediaRoute();
            handler.postDelayed(this, REASSERT_MS);
        }
    };

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("qwaudio", Context.MODE_PRIVATE);
    }

    private void loadInputRoute() {
        inputRoute = "bluetooth".equals(prefs().getString("inputRoute", "phone")) ? 1 : 0;
    }

    private AudioManager audio() {
        if (audioManager == null) {
            audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        }
        return audioManager;
    }

    @PluginMethod
    public void start(PluginCall call) {
        AudioManager am = audio();
        JSObject result = new JSObject();
        if (am == null) {
            result.put("active", false);
            call.resolve(result);
            return;
        }
        if (handler == null) handler = new Handler(Looper.getMainLooper());
        loadInputRoute();
        active = true;
        requestFocus(am);
        enforceMediaRoute();
        handler.removeCallbacks(reassert);
        handler.postDelayed(reassert, REASSERT_MS);
        result.put("active", true);
        result.put("mode", am.getMode());
        result.put("volume", am.getStreamVolume(AudioManager.STREAM_MUSIC));
        result.put("maxVolume", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        active = false;
        if (handler != null) handler.removeCallbacks(reassert);
        abandonFocus(audio());
        call.resolve();
    }

    /** Raise or lower the media volume, for an in-app volume control. */
    @PluginMethod
    public void volume(PluginCall call) {
        AudioManager am = audio();
        JSObject result = new JSObject();
        if (am == null) {
            result.put("volume", 0);
            result.put("maxVolume", 0);
            call.resolve(result);
            return;
        }
        Integer level = call.getInt("level");
        if (level != null) {
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.max(0, Math.min(max, level)), 0);
        }
        result.put("volume", am.getStreamVolume(AudioManager.STREAM_MUSIC));
        result.put("maxVolume", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        call.resolve(result);
    }

    /** Microphones the user can choose from. */
    @PluginMethod
    public void listInputs(PluginCall call) {
        loadInputRoute();
        AudioManager am = audio();
        JSArray inputs = new JSArray();
        inputs.put(new JSObject().put("id", "phone").put("label", "Phone microphone").put("kind", "builtin"));
        if (am != null) {
            AudioDeviceInfo sco = findSco(am);
            if (sco != null || hasBluetoothOutput(am)) {
                String name = sco != null ? String.valueOf(sco.getProductName()) : "";
                inputs.put(new JSObject()
                    .put("id", "bluetooth")
                    .put("label", name.isEmpty() ? "Bluetooth headset microphone" : name)
                    .put("kind", "bluetooth"));
            }
        }
        call.resolve(new JSObject()
            .put("inputs", inputs)
            .put("route", inputRoute == 1 ? "bluetooth" : "phone"));
    }

    /**
     * Switch which microphone captures speech. Bluetooth microphones only work
     * through the headset's call (SCO) profile, which also sends the reply over
     * that profile, so output drops from A2DP quality to call quality.
     */
    @PluginMethod
    public void setInputRoute(PluginCall call) {
        AudioManager am = audio();
        String route = call.getString("route", "phone");
        if ("bluetooth".equals(route) && am != null && findSco(am) == null && !hasBluetoothOutput(am)) {
            inputRoute = 0;
            prefs().edit().putString("inputRoute", "phone").apply();
            enforceMediaRoute();
            JSObject result = new JSObject().put("route", "phone");
            result.put("error", "No Bluetooth headset is connected");
            call.resolve(result);
            return;
        }
        inputRoute = "bluetooth".equals(route) ? 1 : 0;
        prefs().edit().putString("inputRoute", inputRoute == 1 ? "bluetooth" : "phone").apply();
        enforceMediaRoute();
        call.resolve(new JSObject().put("route", inputRoute == 1 ? "bluetooth" : "phone"));
    }

    private boolean hasBluetoothOutput(AudioManager am) {
        for (AudioDeviceInfo device : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                || device.getType() == AudioDeviceInfo.TYPE_BLE_HEADSET) return true;
        }
        return false;
    }

    private AudioDeviceInfo findSco(AudioManager am) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null;
        for (AudioDeviceInfo device : am.getAvailableCommunicationDevices()) {
            if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return device;
        }
        return null;
    }

    private void enforceMediaRoute() {
        AudioManager am = audio();
        if (am == null) return;
        // A real phone call owns the audio path; never pull routing out from
        // under it. Enforcement resumes by itself after the call ends.
        if (am.getMode() == AudioManager.MODE_IN_CALL) return;
        if (inputRoute == 1) {
            // Headset microphone: keep the call profile alive so capture uses
            // SCO. Output goes over the same profile, by design.
            AudioDeviceInfo sco = findSco(am);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && sco != null) {
                if (am.getCommunicationDevice() != sco) am.setCommunicationDevice(sco);
            } else if (!am.isBluetoothScoOn()) {
                // Ask the system to bring the headset's call profile up.
                am.startBluetoothSco();
                am.setBluetoothScoOn(true);
            }
            if (am.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            }
            return;
        }
        if (am.getMode() != AudioManager.MODE_NORMAL) {
            am.setMode(AudioManager.MODE_NORMAL);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.getCommunicationDevice() != null) {
            am.clearCommunicationDevice();
        }
        if (am.isSpeakerphoneOn()) am.setSpeakerphoneOn(false);
        if (am.isBluetoothScoOn()) {
            am.setBluetoothScoOn(false);
            am.stopBluetoothSco();
        }
    }

    private void requestFocus(AudioManager am) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) return;
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .setWillPauseWhenDucked(false)
                .build();
            am.requestAudioFocus(focusRequest);
            return;
        }
        am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
    }

    private void abandonFocus(AudioManager am) {
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) {
                am.abandonAudioFocusRequest(focusRequest);
                focusRequest = null;
            }
            return;
        }
        am.abandonAudioFocus(null);
    }

    @Override
    protected void handleOnDestroy() {
        active = false;
        if (handler != null) handler.removeCallbacks(reassert);
        abandonFocus(audio());
        super.handleOnDestroy();
    }
}
