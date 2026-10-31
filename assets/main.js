window.boot = function () {
    var settings = window._CCSettings;
    window._CCSettings = undefined;
    var onProgress = null;
    
    var RESOURCES = cc.AssetManager.BuiltinBundleName.RESOURCES;
    var INTERNAL = cc.AssetManager.BuiltinBundleName.INTERNAL;
    var MAIN = cc.AssetManager.BuiltinBundleName.MAIN;
    function setLoadingDisplay () {
        // Loading splash scene
        var splash = document.getElementById('splash');
        var progressBar = splash.querySelector('.progress-bar span');
        onProgress = function (finish, total) {
            var percent = 100 * finish / total;
            if (progressBar) {
                progressBar.style.width = percent.toFixed(2) + '%';
            }
        };
        splash.style.display = 'block';
        progressBar.style.width = '0%';

        cc.director.once(cc.Director.EVENT_AFTER_SCENE_LAUNCH, function () {
            splash.style.display = 'none';
        });
    }

    var onStart = function () {

        cc.view.enableRetina(true);
        cc.view.resizeWithBrowserSize(true);

        if (cc.sys.isBrowser) {
            setLoadingDisplay();
        }

        if (cc.sys.isMobile) {
            if (settings.orientation === 'landscape') {
                cc.view.setOrientation(cc.macro.ORIENTATION_LANDSCAPE);
            }
            else if (settings.orientation === 'portrait') {
                cc.view.setOrientation(cc.macro.ORIENTATION_PORTRAIT);
            }
            cc.view.enableAutoFullScreen([
                cc.sys.BROWSER_TYPE_BAIDU,
                cc.sys.BROWSER_TYPE_BAIDU_APP,
                cc.sys.BROWSER_TYPE_WECHAT,
                cc.sys.BROWSER_TYPE_MOBILE_QQ,
                cc.sys.BROWSER_TYPE_MIUI,
                cc.sys.BROWSER_TYPE_HUAWEI,
                cc.sys.BROWSER_TYPE_UC,
            ].indexOf(cc.sys.browserType) < 0);
        }

        // Limit downloading max concurrent task to 2,
        // more tasks simultaneously may cause performance draw back on some android system / browsers.
        // You can adjust the number based on your own test result, you have to set it before any loading process to take effect.
        if (cc.sys.isBrowser && cc.sys.os === cc.sys.OS_ANDROID) {
            cc.assetManager.downloader.maxConcurrency = 2;
            cc.assetManager.downloader.maxRequestsPerFrame = 2;
        }

        var launchScene = settings.launchScene;
        var bundle = cc.assetManager.bundles.find(function (b) {
            return b.getSceneInfo(launchScene);
        });
        
        bundle.loadScene(launchScene, null, onProgress,
            function (err, scene) {
                if (!err) {
                    cc.director.runSceneImmediate(scene);
                    if (cc.sys.isBrowser) {
                        // show canvas
                        var canvas = document.getElementById('GameCanvas');
                        canvas.style.visibility = '';
                        var div = document.getElementById('GameDiv');
                        if (div) {
                            div.style.backgroundImage = '';
                        }
                        console.log('Success to load scene: ' + launchScene);
                    }
                }
            }
        );

    };

    var option = {
        id: 'GameCanvas',
        debugMode: settings.debug ? cc.debug.DebugMode.INFO : cc.debug.DebugMode.ERROR,
        showFPS: settings.debug,
        frameRate: 60,
        groupList: settings.groupList,
        collisionMatrix: settings.collisionMatrix,
    };

    cc.assetManager.init({ 
        bundleVers: settings.bundleVers,
        remoteBundles: settings.remoteBundles,
        server: settings.server
    });
    
    var bundleRoot = [INTERNAL];
    settings.hasResourcesBundle && bundleRoot.push(RESOURCES);

    var count = 0;
    function cb (err) {
        if (err) return console.error(err.message, err.stack);
        count++;
        if (count === bundleRoot.length + 1) {
            cc.assetManager.loadBundle(MAIN, function (err) {
                if (!err) cc.game.run(option, onStart);
            });
        }
    }

    cc.assetManager.loadScript(settings.jsList.map(function (x) { return 'src/' + x;}), cb);

    for (var i = 0; i < bundleRoot.length; i++) {
        cc.assetManager.loadBundle(bundleRoot[i], cb);
    }
};

// ---------------------------------------------------------------------------
// Standalone Android boot: build-time config + hot-updated adapter (ES5, JSB only).
//
// tools/client-native-patch.mjs fills the three markers below (each must occur exactly once):
//   build-config      -> {"apiBase":...,"wsUrl":...,...}
//   bundled-adapter   -> {"version":n,"sha256":"..."} of assets/standalone-native.js
//   acceptance        -> acceptance adapter (acceptance builds only) or nothing
//
// Start-up: GET <apiBase>/client/native/manifest.json within 8 s
//   { "version": n, "sha256": "<64 hex>", "path": "/client/native/standalone-native.js" }
// When the server copy is newer than the bundled one, use the verified cache under
// jsb.fileUtils.getWritablePath() or download it (sha256 checked in pure JS, JSB has no
// WebCrypto), cache it and run it. Any failure falls back to the bundled standalone-native.js.
// The adapter reads window.STANDALONE_CONFIG; it never carries addresses of its own.
// ---------------------------------------------------------------------------
window.StandaloneNativeBoot = (function () {
    'use strict';
    var MANIFEST_PATH = '/client/native/manifest.json';
    // 10-31 真机：手机走代理连美西，3 秒内拿不到清单就退回内置版，放宽到 8 秒。
    var MANIFEST_TIMEOUT_MS = 8000;
    var SCRIPT_TIMEOUT_MS = 6000;
    var SCRIPT_PATH = /^\/client\/native\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
    var SHA256_HEX = /^[0-9a-f]{64}$/;
    var CACHE_DIR = 'standalone-native/';
    var CACHE_SCRIPT = 'adapter.js';
    var CACHE_META = 'adapter.json';

    var K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    // UTF-8 bytes of a JS string; lone surrogates become U+FFFD (same as Node's Buffer.from).
    function utf8Bytes(text) {
        var out = [], i, c, d;
        for (i = 0; i < text.length; i++) {
            c = text.charCodeAt(i);
            if (c < 0x80) {
                out.push(c);
            } else if (c < 0x800) {
                out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length &&
                (d = text.charCodeAt(i + 1)) >= 0xdc00 && d <= 0xdfff) {
                c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
                i++;
                out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            } else {
                if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
                out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            }
        }
        return out;
    }

    function sha256Hex(text) {
        var bytes = utf8Bytes(String(text));
        var length = bytes.length;
        var bitsHigh = Math.floor(length / 0x20000000);
        var bitsLow = (length << 3) >>> 0;
        var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        var W = new Array(64);
        var offset, t, a, b, c, d, e, f, g, h, x, y, t1, t2, hex, i;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        bytes.push((bitsHigh >>> 24) & 255, (bitsHigh >>> 16) & 255, (bitsHigh >>> 8) & 255, bitsHigh & 255,
            (bitsLow >>> 24) & 255, (bitsLow >>> 16) & 255, (bitsLow >>> 8) & 255, bitsLow & 255);
        for (offset = 0; offset < bytes.length; offset += 64) {
            for (t = 0; t < 16; t++) {
                i = offset + t * 4;
                W[t] = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
            }
            for (t = 16; t < 64; t++) {
                x = W[t - 15];
                y = W[t - 2];
                W[t] = (W[t - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) +
                    W[t - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
            }
            a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
            for (t = 0; t < 64; t++) {
                t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) +
                    ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
                t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) +
                    ((a & b) ^ (a & c) ^ (b & c))) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
            H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
        }
        hex = '';
        for (i = 0; i < 8; i++) hex += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
        return hex;
    }

    function log(message) {
        try { console.log('[standalone-native] ' + message); } catch (_) {}
    }

    // http(s) origin only, no trailing slash; null when the build config is unusable.
    function apiOrigin(config) {
        var base = config && typeof config.apiBase === 'string' ? config.apiBase.replace(/\/+$/, '') : '';
        return /^https?:\/\/[^\/?#@\s\\]+$/.test(base) ? base : null;
    }

    function parseManifest(text) {
        var value = JSON.parse(text);
        if (!value || typeof value !== 'object') return null;
        var version = value.version;
        var sha256 = typeof value.sha256 === 'string' ? value.sha256.toLowerCase() : '';
        if (typeof version !== 'number' || !isFinite(version) || version < 0 || Math.floor(version) !== version) return null;
        if (!SHA256_HEX.test(sha256)) return null;
        if (typeof value.path !== 'string' || !SCRIPT_PATH.test(value.path)) return null;
        return { version: version, sha256: sha256, path: value.path };
    }

    // GET text with a hard timeout; done(error, text) runs exactly once.
    function request(url, timeoutMs, done) {
        var settled = false, xhr = null, timer = null;
        function finish(error, text) {
            if (settled) return;
            settled = true;
            if (timer !== null) { clearTimeout(timer); timer = null; }
            if (error && xhr) { try { xhr.abort(); } catch (_) {} }
            done(error, text);
        }
        try {
            timer = setTimeout(function () { timer = null; finish(new Error('timeout')); }, timeoutMs);
            xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            try { xhr.timeout = timeoutMs; } catch (_) {}
            xhr.onreadystatechange = function () {
                if (settled || xhr.readyState !== 4) return;
                if (xhr.status === 200 && typeof xhr.responseText === 'string') finish(null, xhr.responseText);
                else finish(new Error('http-' + xhr.status));
            };
            xhr.onerror = function () { finish(new Error('network')); };
            xhr.ontimeout = function () { finish(new Error('timeout')); };
            xhr.send();
        } catch (error) {
            finish(error instanceof Error ? error : new Error('request'));
        }
    }

    function cacheDir() {
        var root = jsb.fileUtils.getWritablePath();
        if (!root) return null;
        if (root.charAt(root.length - 1) !== '/') root += '/';
        return root + CACHE_DIR;
    }

    // Cached copy only counts when its own bytes hash to the manifest's sha256.
    function readCache(manifest) {
        try {
            var dir = cacheDir();
            if (!dir || !jsb.fileUtils.isFileExist(dir + CACHE_SCRIPT)) return null;
            var code = jsb.fileUtils.getStringFromFile(dir + CACHE_SCRIPT);
            if (!code || sha256Hex(code) !== manifest.sha256) return null;
            return code;
        } catch (error) {
            log('cache read failed: ' + error);
            return null;
        }
    }

    function writeCache(code, manifest) {
        try {
            var dir = cacheDir();
            if (!dir) return false;
            if (!jsb.fileUtils.isDirectoryExist(dir)) jsb.fileUtils.createDirectory(dir);
            if (!jsb.fileUtils.writeStringToFile(code, dir + CACHE_SCRIPT)) return false;
            jsb.fileUtils.writeStringToFile(JSON.stringify({ version: manifest.version, sha256: manifest.sha256 }), dir + CACHE_META);
            return true;
        } catch (error) {
            log('cache write failed: ' + error);
            return false;
        }
    }

    function dropCache() {
        try {
            var dir = cacheDir();
            if (!dir) return;
            if (jsb.fileUtils.isFileExist(dir + CACHE_SCRIPT)) jsb.fileUtils.removeFile(dir + CACHE_SCRIPT);
            if (jsb.fileUtils.isFileExist(dir + CACHE_META)) jsb.fileUtils.removeFile(dir + CACHE_META);
        } catch (_) {}
    }

    // Global-scope evaluation, like require() would do.
    function runScript(code, name) {
        (0, eval)(code + '\n//# sourceURL=' + name);
    }

    // done() runs exactly once, after window.Standalone has been defined by one adapter copy.
    function start(config, bundled, done) {
        var finished = false;
        function finish(source) {
            if (finished) return;
            finished = true;
            window.STANDALONE_NATIVE_SOURCE = source;
            log(source.kind + ' adapter v' + source.version + (source.reason ? ' (' + source.reason + ')' : ''));
            done();
        }
        function useBundled(reason) {
            if (finished) return;
            require('standalone-native.js');
            finish({ kind: 'bundled', version: bundled ? bundled.version : 0, sha256: bundled ? bundled.sha256 : '', reason: reason });
            report(reason);
        }
        // 热更新没成功时，把原因带在一次清单请求上发给服务器（只进访问日志，不等回应），方便查卡在哪一步。
        function report(reason) {
            if (!base || base.indexOf('https://') !== 0 || !/^(manifest-|script-|sha256-|hot-)/.test(reason)) return;
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', base + MANIFEST_PATH + '?fallback=' + encodeURIComponent(reason) + '&from=' + (bundled ? bundled.version : 0), true);
                xhr.send();
            } catch (_) {}
        }
        function useHot(code, manifest, kind) {
            if (finished) return;
            try {
                runScript(code, 'standalone-native-hot.js');
            } catch (error) {
                log('hot adapter failed: ' + (error && error.stack || error));
                dropCache();
                return useBundled('hot-error');
            }
            finish({ kind: kind, version: manifest.version, sha256: manifest.sha256, reason: '' });
        }
        var base = apiOrigin(config);
        if (!base) return useBundled('no-config');
        // 明文 http 下载的脚本可能被中途改掉，只在 https 服务器上热更新；http 包一律用内置版。
        if (base.indexOf('https://') !== 0) return useBundled('insecure-origin');
        if (!bundled || typeof bundled.version !== 'number' || !SHA256_HEX.test(String(bundled.sha256))) return useBundled('no-bundle-info');
        request(base + MANIFEST_PATH + '?ts=' + Date.now(), MANIFEST_TIMEOUT_MS, function (error, text) {
            if (error) return useBundled('manifest-' + error.message);
            var manifest = null;
            try { manifest = parseManifest(text); } catch (_) {}
            if (!manifest) return useBundled('manifest-invalid');
            if (manifest.sha256 === bundled.sha256) return useBundled('up-to-date');
            if (manifest.version <= bundled.version) return useBundled('server-older');
            var cached = readCache(manifest);
            if (cached !== null) return useHot(cached, manifest, 'cache');
            request(base + manifest.path + '?sha256=' + manifest.sha256, SCRIPT_TIMEOUT_MS, function (scriptError, code) {
                if (scriptError) return useBundled('script-' + scriptError.message);
                var actual = '';
                try { actual = sha256Hex(code); } catch (_) {}
                if (actual !== manifest.sha256) return useBundled('sha256-mismatch');
                writeCache(code, manifest);
                useHot(code, manifest, 'hot');
            });
        });
    }

    return { start: start, sha256Hex: sha256Hex, utf8Bytes: utf8Bytes, parseManifest: parseManifest, apiOrigin: apiOrigin };
})();

if (window.jsb) {
    var isRuntime = (typeof loadRuntime === 'function');
    if (isRuntime) {
        require('src/settings.js');
        require('src/cocos2d-runtime.js');
        if (CC_PHYSICS_BUILTIN || CC_PHYSICS_CANNON) {
            require('src/physics.js');
        }
        require('jsb-adapter/engine/index.js');
    }
    else {
        require('src/settings.js');
        require('src/cocos2d-jsb.js');
        if (CC_PHYSICS_BUILTIN || CC_PHYSICS_CANNON) {
            require('src/physics.js');
        }
        require('jsb-adapter/jsb-engine.js');
    }

    cc.macro.CLEANUP_IMAGE_CACHE = true;
    window.STANDALONE_CONFIG = null /* @standalone-build-config */;
    require('decimal.js');
    require('edition-config.js');
    window.StandaloneNativeBoot.start(window.STANDALONE_CONFIG, null /* @standalone-bundled-adapter */, function () {
        require('standalone-replay.js');
        window.Standalone.isolateStorage();
        /* @standalone-acceptance */
        window.boot();
    });
}
