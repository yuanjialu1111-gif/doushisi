package net.doushisi.acceptance;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.UUID;

public final class AcceptanceInstrumentation extends Instrumentation {
    private static final String TAG = "DSS_ACCEPTANCE";
    private static final String TARGET_PACKAGE = "net.doushisi.standalone";
    private static final String TARGET_ACTIVITY = "org.cocos2dx.javascript.AppActivity";
    private static final String JS_BRIDGE = "org.cocos2dx.lib.Cocos2dxJavascriptJavaBridge";
    private static final String ASSET_SCRIPT = "acceptance-client-adapter.js";
    private static final String CALLBACK_CLASS = "net/doushisi/acceptance/AcceptanceInstrumentation";
    private static final String CALLBACK_METHOD = "onAcceptanceResult";
    private static final String CALLBACK_SIGNATURE = "(Ljava/lang/String;)V";
    private static final long ACTIVITY_TIMEOUT_MS = 30_000L;
    private static final long READY_TIMEOUT_MS = 60_000L;
    private static final long RESULT_TIMEOUT_MS = 30_000L;
    private static final long MIN_RESULT_TIMEOUT_MS = 1_000L;
    private static final long MAX_RESULT_TIMEOUT_MS = 120_000L;
    private static final long POLL_INTERVAL_MS = 250L;
    private static final String ADAPTER_VERSION = "local-acceptance-v2";
    private static final String DEFAULT_PROCESS_MODE = "reconnect";

    private static volatile JSONObject result;
    private static volatile String callbackError;
    private static volatile String currentCommandId;
    private static volatile boolean scriptInstalled;
    private static volatile String scriptError;
    private static volatile AcceptanceInstrumentation currentInstrumentation;
    private static volatile Context targetContext;
    private Bundle arguments;

    public AcceptanceInstrumentation() {
        super();
    }

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        currentInstrumentation = this;
        this.arguments = arguments == null ? Bundle.EMPTY : new Bundle(arguments);
        start();
    }

    @Override
    public void onStart() {
        String commandId = "unknown";
        try {
            commandId = runCommand();
            Bundle status = new Bundle();
            sendStatus(0, status);
            finish(Activity.RESULT_OK, status);
        } catch (Failure failure) {
            fail(currentCommandId != null ? currentCommandId : commandId, failure.code, failure.getMessage());
        } catch (Throwable throwable) {
            fail(currentCommandId != null ? currentCommandId : commandId, "INTERNAL_ERROR", throwable.getClass().getSimpleName() + ": " + safeMessage(throwable));
        }
    }

    private String runCommand() throws Failure {
        String command = readCommand();
        final JSONObject commandJson;
        try {
            commandJson = new JSONObject(command);
        } catch (Throwable throwable) {
            throw new Failure("INVALID_COMMAND_JSON", "Command input does not contain a JSON object.");
        }
        String id = commandJson.optString("id", "unknown");
        currentCommandId = id;
        long resultTimeoutMs = resultTimeout(commandJson);
        String processMode = processMode(commandJson);
        long previousProcessId = commandJson.optLong("previousProcessId", -1L);

        String script = readScript();
        String expectedScriptSha256 = sha256(script == null ? "" : script);
        Context context = getTargetContext();
        if (context == null) {
            throw new Failure("NO_TARGET_CONTEXT", "Target application context is unavailable.");
        }
        targetContext = context;
        long processIdBefore = processId();
        startActivityAndWait(context);
        waitForRuntime();

        if (script != null && !script.trim().isEmpty()) {
            scriptInstalled = false;
            scriptError = null;
            String scriptId = "script_" + UUID.randomUUID().toString().replace("-", "");
            invokeOnGlThread(buildScriptInstallScript(script, scriptId, expectedScriptSha256));
            waitForScriptInstall();
        }

        result = null;
        callbackError = null;
        String probeId = "ready_" + UUID.randomUUID().toString().replace("-", "");
        String probeCommand = "{\"id\":" + JSONObject.quote(probeId) + ",\"action\":\"runtime-ready\",\"timeoutMs\":5000}";
        invokeOnGlThread(buildDispatchScript(probeCommand, probeId));
        JSONObject probe = waitForResult(probeId, READY_TIMEOUT_MS, "LOCAL_ACCEPTANCE_TIMEOUT",
                "window.LocalAcceptance.dispatch did not answer the readiness probe before timeout.");
        if (!probe.optBoolean("ok", false)) {
            throw new Failure("LOCAL_ACCEPTANCE_UNAVAILABLE", "window.LocalAcceptance.dispatch rejected the readiness probe.");
        }
        verifyAdapterIdentity(probe, expectedScriptSha256);

        long processIdAfter = processId();
        if ("restart".equals(processMode)) {
            if (previousProcessId <= 0 || processIdAfter <= 0 || previousProcessId == processIdAfter) {
                throw new Failure("PROCESS_RESTART_NOT_CONFIRMED", "Restart mode did not change the target application process id.");
            }
        } else if (processIdBefore <= 0 || processIdAfter <= 0 || processIdAfter != processIdBefore) {
            throw new Failure("PROCESS_RECONNECT_CHANGED_PID", "Reconnect mode changed the target application process id.");
        }

        result = null;
        callbackError = null;
        invokeOnGlThread(buildDispatchScript(command, id));
        JSONObject payload = waitForResult(id, resultTimeoutMs, "RESULT_TIMEOUT",
                "No JS acceptance result was produced before timeout.");
        Log.i(TAG, payload.toString());
        return id;
    }

    private String readCommand() throws Failure {
        String commandB64 = getArgument("commandB64");
        if (commandB64 != null && !commandB64.isEmpty()) {
            return decodeBase64(commandB64, "commandB64");
        }
        String command = getArgument("command");
        if (command != null && !command.isEmpty()) {
            return command;
        }
        throw new Failure("MISSING_COMMAND", "Instrumentation argument commandB64 or command is required.");
    }

    private long resultTimeout(JSONObject commandJson) {
        long requested = commandJson.optLong("timeoutMs", RESULT_TIMEOUT_MS);
        if (requested < MIN_RESULT_TIMEOUT_MS) {
            return MIN_RESULT_TIMEOUT_MS;
        }
        return Math.min(requested, MAX_RESULT_TIMEOUT_MS);
    }

    private String processMode(JSONObject commandJson) throws Failure {
        String requested = commandJson.optString("processMode", DEFAULT_PROCESS_MODE).trim().toLowerCase();
        if ("reconnect".equals(requested) || "restart".equals(requested)) {
            return requested;
        }
        throw new Failure("INVALID_PROCESS_MODE", "processMode must be reconnect or restart.");
    }

    private long processId() {
        BufferedReader reader = null;
        Process process = null;
        try {
            process = new ProcessBuilder("/system/bin/pidof", TARGET_PACKAGE)
                    .redirectErrorStream(true)
                    .start();
            reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            String line = reader.readLine();
            if (line == null) {
                return -1L;
            }
            String value = line.trim().split("\\s+")[0];
            return value.isEmpty() ? -1L : Long.parseLong(value);
        } catch (Throwable ignored) {
            return -1L;
        } finally {
            if (reader != null) {
                try {
                    reader.close();
                } catch (Throwable ignored) {
                }
            }
            if (process != null) {
                process.destroy();
            }
        }
    }

    private String readScript() throws Failure {
        String scriptB64 = getArgument("scriptB64");
        if (scriptB64 != null && !scriptB64.isEmpty()) {
            return decodeBase64(scriptB64, "scriptB64");
        }
        return readAsset(ASSET_SCRIPT);
    }

    private void startActivityAndWait(Context context) throws Failure {
        Intent intent = new Intent();
        intent.setClassName(TARGET_PACKAGE, TARGET_ACTIVITY);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            startActivitySync(intent);
        } catch (Throwable throwable) {
            throw new Failure("ACTIVITY_START_FAILED", "Could not start " + TARGET_ACTIVITY + ": " + safeMessage(throwable));
        }

        long deadline = SystemClock.uptimeMillis() + ACTIVITY_TIMEOUT_MS;
        while (SystemClock.uptimeMillis() < deadline) {
            if (getActivityReference() != null) {
                return;
            }
            SystemClock.sleep(POLL_INTERVAL_MS);
        }
        throw new Failure("ACTIVITY_TIMEOUT", "AppActivity.that was not available before timeout.");
    }

    private void waitForRuntime() throws Failure {
        long deadline = SystemClock.uptimeMillis() + READY_TIMEOUT_MS;
        while (SystemClock.uptimeMillis() < deadline) {
            if (getActivityReference() != null && hasJsBridge()) {
                return;
            }
            SystemClock.sleep(POLL_INTERVAL_MS);
        }
        throw new Failure("RUNTIME_TIMEOUT", "Cocos2dxJavascriptJavaBridge.evalString was not available before timeout.");
    }

    private String buildDispatchScript(String command, String id) {
        String commandLiteral = JSONObject.quote(command);
        String idLiteral = JSONObject.quote(id);
        return "(function(){"
                + "function report(payload){try{"
                + "jsb.reflection.callStaticMethod(" + JSONObject.quote(CALLBACK_CLASS) + ","
                + JSONObject.quote(CALLBACK_METHOD) + "," + JSONObject.quote(CALLBACK_SIGNATURE) + ",payload);"
                + "}catch(callbackError){}}"
                + "try{"
                + "jsb.reflection.callStaticMethod('android/util/Log','i','(Ljava/lang/String;Ljava/lang/String;)I',"
                + JSONObject.quote(TAG) + ",payload);"
                + "}catch(logError){}"
                + "try{"
                + "if(!window.LocalAcceptance||typeof window.LocalAcceptance.dispatch!=='function')"
                + "throw new Error('window.LocalAcceptance.dispatch is unavailable');"
                + "var value=window.LocalAcceptance.dispatch(" + commandLiteral + ");"
                + "var text=JSON.stringify(value);"
                + "if(typeof text!=='string')throw new Error('dispatch result is not JSON serializable');"
                + "report(text);"
                + "}catch(error){"
                + "report(JSON.stringify({id:" + idLiteral + ",ok:false,error:{code:'JS_EXCEPTION',message:String(error)}}));"
                + "}"
                + "})();";
    }

    private String buildScriptInstallScript(String script, String id) {
        return buildScriptInstallScript(script, id, sha256(script));
    }

    private String buildScriptInstallScript(String script, String id, String sha256) {
        String scriptLiteral = JSONObject.quote(script);
        String idLiteral = JSONObject.quote(id);
        return "(function(){"
                + "function report(payload){try{"
                + "jsb.reflection.callStaticMethod(" + JSONObject.quote(CALLBACK_CLASS) + ","
                + JSONObject.quote("onScriptInstalled") + "," + JSONObject.quote(CALLBACK_SIGNATURE) + ",payload);"
                + "}catch(callbackError){}}"
                + "try{"
                + "window.__DSS_ACCEPTANCE_ADAPTER__={version:" + JSONObject.quote(ADAPTER_VERSION)
                + ",sha256:" + JSONObject.quote(sha256) + "};"
                + "eval(" + scriptLiteral + ");"
                + "report(JSON.stringify({id:" + idLiteral + ",ok:true}));"
                + "}catch(error){"
                + "report(JSON.stringify({id:" + idLiteral + ",ok:false,error:{code:'SCRIPT_EXCEPTION',message:String(error)}}));"
                + "}"
                + "})();";
    }

    private void waitForScriptInstall() throws Failure {
        long deadline = SystemClock.uptimeMillis() + READY_TIMEOUT_MS;
        while (SystemClock.uptimeMillis() < deadline) {
            if (scriptInstalled) {
                return;
            }
            String failure = scriptError;
            if (failure != null) {
                throw new Failure("SCRIPT_EXCEPTION", failure);
            }
            SystemClock.sleep(POLL_INTERVAL_MS);
        }
        throw new Failure("SCRIPT_TIMEOUT", "The supplied adapter script did not finish before timeout.");
    }

    private void invokeOnGlThread(String script) throws Failure {
        try {
            Method method = Class.forName(TARGET_ACTIVITY).getMethod("JSrunOnGLThread", String.class);
            method.invoke(null, script);
        } catch (Throwable throwable) {
            throw new Failure("JS_INJECTION_FAILED", "JSrunOnGLThread failed: " + safeMessage(throwable));
        }
    }

    private JSONObject waitForResult(String id, long timeoutMs, String timeoutCode, String timeoutMessage) throws Failure {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (SystemClock.uptimeMillis() < deadline) {
            JSONObject value = result;
            if (value != null && id.equals(value.optString("id", ""))) {
                return normalizeResult(value, id);
            }
            JSONObject logcatValue = readLogcatResult(id);
            if (logcatValue != null) {
                return normalizeResult(logcatValue, id);
            }
            String callbackFailure = callbackError;
            if (callbackFailure != null) {
                throw new Failure("JS_CALLBACK_FAILED", callbackFailure);
            }
            SystemClock.sleep(POLL_INTERVAL_MS);
        }
        recoverFromTimeout(id);
        throw new Failure(timeoutCode, timeoutMessage);
    }

    private void recoverFromTimeout(String id) {
        try {
            result = null;
            callbackError = null;
            String resetId = "reset_" + UUID.randomUUID().toString().replace("-", "");
            String resetCommand = "{\"id\":" + JSONObject.quote(resetId) + ",\"action\":\"reset\"}";
            invokeOnGlThread(buildDispatchScript(resetCommand, resetId));
            long deadline = SystemClock.uptimeMillis() + 5000L;
            while (SystemClock.uptimeMillis() < deadline) {
                JSONObject value = result;
                if (value != null && resetId.equals(value.optString("id", ""))) {
                    return;
                }
                SystemClock.sleep(POLL_INTERVAL_MS);
            }
            Log.w(TAG, "Timed-out command did not acknowledge adapter reset: " + id);
        } catch (Throwable resetFailure) {
            Log.w(TAG, "Failed to reset adapter after timeout for " + id + ": " + safeMessage(resetFailure));
        }
    }

    private void verifyAdapterIdentity(JSONObject probe, String expectedSha256) throws Failure {
        Object detailValue = probe.opt("detail");
        JSONObject detail = detailValue instanceof JSONObject ? (JSONObject) detailValue : null;
        if (detail == null) {
            throw new Failure("ADAPTER_IDENTITY_MISSING", "Readiness probe did not return adapter identity.");
        }
        String version = detail.optString("adapter", "");
        String sha256 = detail.optString("sha256", "").toLowerCase();
        if (!ADAPTER_VERSION.equals(version) || !sha256.matches("[0-9a-f]{64}")
                || expectedSha256 == null || !expectedSha256.equals(sha256)) {
            throw new Failure("ADAPTER_IDENTITY_MISMATCH", "Readiness probe returned an unknown adapter version or an unexpected script hash.");
        }
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(bytes.length * 2);
            for (byte item : bytes) {
                output.append(String.format("%02x", item & 0xff));
            }
            return output.toString();
        } catch (Throwable throwable) {
            throw new IllegalStateException("SHA-256 is unavailable", throwable);
        }
    }

    private JSONObject normalizeResult(JSONObject value, String expectedId) throws Failure {
        String id = value.optString("id", "");
        if (id.isEmpty() || !expectedId.equals(id)) {
            throw new Failure("INVALID_JS_RESULT", "JS result id does not match the command id.");
        }

        JSONObject normalized = new JSONObject();
        try {
            normalized.put("id", id);
            normalized.put("ok", value.optBoolean("ok", false));
            if (value.has("detail")) {
                Object detail = value.opt("detail");
                if (detail instanceof String) {
                    String text = (String) detail;
                    try {
                        normalized.put("detail", new JSONObject(text));
                    } catch (Throwable ignored) {
                        normalized.put("detail", text);
                    }
                } else {
                    normalized.put("detail", detail);
                }
            } else {
                normalized.put("detail", JSONObject.NULL);
            }
            if (value.has("error")) {
                normalized.put("error", value.opt("error"));
            }
        } catch (Throwable throwable) {
            throw new Failure("INVALID_JS_RESULT", "JS result could not be normalized: " + safeMessage(throwable));
        }
        return normalized;
    }

    private JSONObject readLogcatResult(String id) {
        BufferedReader reader = null;
        Process process = null;
        try {
            process = new ProcessBuilder("/system/bin/logcat", "-d", "-v", "raw", "-s", TAG + ":V")
                    .redirectErrorStream(true)
                    .start();
            reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                int marker = line.indexOf(TAG);
                if (marker < 0) {
                    continue;
                }
                int start = line.indexOf('{', marker);
                if (start < 0) {
                    continue;
                }
                try {
                    JSONObject candidate = new JSONObject(line.substring(start).trim());
                    if (id.equals(candidate.optString("id", ""))) {
                        return candidate;
                    }
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable ignored) {
        } finally {
            if (reader != null) {
                try {
                    reader.close();
                } catch (Throwable ignored) {
                }
            }
            if (process != null) {
                process.destroy();
            }
        }
        return null;
    }

    public static void onAcceptanceResult(String json) {
        if (json == null || json.trim().isEmpty()) {
            callbackError = "JS callback returned an empty result.";
            return;
        }
        try {
            if ("true".equals(json) || "false".equals(json) || "null".equals(json)) {
                // Legacy adapters return a boolean and publish their full result through logcat.
                return;
            }
            JSONObject value = new JSONObject(json);
            if (!value.has("id") || !value.has("ok")) {
                callbackError = "JS callback result must contain id and ok.";
                return;
            }
            result = value;
        } catch (Throwable throwable) {
            callbackError = "JS callback returned non-JSON data: " + safeMessage(throwable);
        }
    }

    public static void onScriptInstalled(String json) {
        if (json == null || json.trim().isEmpty()) {
            scriptError = "Script installation callback returned an empty result.";
            return;
        }
        try {
            JSONObject value = new JSONObject(json);
            if (value.optBoolean("ok", false)) {
                scriptInstalled = true;
                return;
            }
            Object error = value.opt("error");
            if (error instanceof JSONObject) {
                scriptError = ((JSONObject) error).optString("message", "Script installation failed.");
            } else {
                scriptError = "Script installation failed.";
            }
        } catch (Throwable throwable) {
            scriptError = "Script installation returned non-JSON data: " + safeMessage(throwable);
        }
    }

    public static String getLocationEvidence() {
        JSONObject payload = new JSONObject();
        Context context = targetContext;
        long observedAt = System.currentTimeMillis();
        try {
            payload.put("observedAt", observedAt);
            if (context == null) {
                payload.put("permission", "none");
                payload.put("available", false);
                return payload.toString();
            }

            String permission = null;
            if (context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                permission = android.Manifest.permission.ACCESS_FINE_LOCATION;
            } else if (context.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                permission = android.Manifest.permission.ACCESS_COARSE_LOCATION;
            }
            payload.put("permission", permission == null ? "none" : permission);
            if (permission == null) {
                payload.put("available", false);
                return payload.toString();
            }

            LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (manager == null) {
                payload.put("available", false);
                return payload.toString();
            }

            Location best = null;
            List<String> providers = manager.getProviders(true);
            for (String provider : providers) {
                Location candidate;
                try {
                    candidate = manager.getLastKnownLocation(provider);
                } catch (SecurityException denied) {
                    continue;
                }
                if (candidate == null) {
                    continue;
                }
                if (best == null || candidate.getTime() > best.getTime()
                        || candidate.getTime() == best.getTime() && accuracyOf(candidate) < accuracyOf(best)) {
                    best = candidate;
                }
            }
            if (best == null) {
                payload.put("available", false);
                return payload.toString();
            }

            long timestamp = best.getTime();
            payload.put("available", true);
            payload.put("provider", best.getProvider() == null ? "" : best.getProvider());
            payload.put("timestamp", timestamp);
            payload.put("ageMs", Math.max(0L, observedAt - timestamp));
            payload.put("accuracy", best.hasAccuracy() ? (double) best.getAccuracy() : JSONObject.NULL);
            payload.put("latitude", best.getLatitude());
            payload.put("longitude", best.getLongitude());
            payload.put("elapsedRealtimeNanos", best.getElapsedRealtimeNanos());
            return payload.toString();
        } catch (Throwable throwable) {
            try {
                payload.put("available", false);
                payload.put("error", safeMessage(throwable));
            } catch (Throwable ignored) {
            }
            return payload.toString();
        }
    }

    private static float accuracyOf(Location location) {
        return location.hasAccuracy() ? location.getAccuracy() : Float.MAX_VALUE;
    }

    private Object getActivityReference() {
        try {
            Class<?> activityClass = Class.forName(TARGET_ACTIVITY);
            Field field = activityClass.getDeclaredField("that");
            field.setAccessible(true);
            return field.get(null);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private boolean hasJsBridge() {
        try {
            Class<?> bridge = Class.forName(JS_BRIDGE);
            bridge.getMethod("evalString", String.class);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private String getArgument(String name) {
        String value = arguments.getString(name);
        return value == null ? null : value.trim();
    }

    private String decodeBase64(String value, String name) throws Failure {
        try {
            String normalized = value.replace('-', '+').replace('_', '/').replaceAll("\\s", "");
            if (!normalized.matches("[A-Za-z0-9+/]*={0,2}")) {
                throw new IllegalArgumentException("invalid base64 characters");
            }
            int remainder = normalized.length() % 4;
            if (remainder == 1) {
                throw new IllegalArgumentException("invalid base64 length");
            }
            if (remainder > 0) {
                normalized = normalized + "====".substring(0, 4 - remainder);
            }
            byte[] decoded = Base64.decode(normalized, Base64.DEFAULT);
            return new String(decoded, StandardCharsets.UTF_8);
        } catch (Throwable throwable) {
            throw new Failure("INVALID_BASE64", name + " is not valid base64 UTF-8.");
        }
    }

    private String readAsset(String name) throws Failure {
        InputStream stream = null;
        try {
            stream = getContext().getAssets().open(name);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (Throwable throwable) {
            throw new Failure("ASSET_READ_FAILED", "Could not read driver asset " + name + ": " + safeMessage(throwable));
        } finally {
            if (stream != null) {
                try {
                    stream.close();
                } catch (Throwable ignored) {
                }
            }
        }
    }

    private void fail(String id, String code, String message) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("id", id == null || id.isEmpty() ? "unknown" : id);
            payload.put("ok", false);
            JSONObject error = new JSONObject();
            error.put("code", code);
            error.put("message", message == null ? "" : message);
            payload.put("error", error);
        } catch (Throwable ignored) {
            payload = new JSONObject();
        }
        Log.e(TAG, payload.toString());
        Bundle status = new Bundle();
        status.putString("error", code + ": " + (message == null ? "" : message));
        sendStatus(Activity.RESULT_CANCELED, status);
        finish(Activity.RESULT_CANCELED, status);
    }

    private static String safeMessage(Throwable throwable) {
        String message = throwable.getMessage();
        return message == null || message.isEmpty() ? throwable.getClass().getName() : message;
    }

    private static final class Failure extends Exception {
        final String code;

        Failure(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
