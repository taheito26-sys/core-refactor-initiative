package com.taheito26sys.corerefactorinitiative;

import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PrivacyShield")
public class PrivacyShieldPlugin extends Plugin {
    private android.app.Activity.ScreenCaptureCallback screenCaptureCallback;

    @Override
    public void load() {
        super.load();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && getActivity() != null) {
            screenCaptureCallback = new android.app.Activity.ScreenCaptureCallback() {
                @Override
                public void onScreenCaptured() {
                    emitPrivacySignal("screenshot");
                }
            };

            getActivity().registerScreenCaptureCallback(
                ContextCompat.getMainExecutor(getContext()),
                screenCaptureCallback
            );
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            && getActivity() != null
            && screenCaptureCallback != null) {
            getActivity().unregisterScreenCaptureCallback(screenCaptureCallback);
            screenCaptureCallback = null;
        }
        super.handleOnDestroy();
    }

    private void emitPrivacySignal(@NonNull String source) {
        JSObject payload = new JSObject();
        payload.put("source", source);
        payload.put("platform", "android");
        notifyListeners("privacyCaptureDetected", payload, true);
    }
}
