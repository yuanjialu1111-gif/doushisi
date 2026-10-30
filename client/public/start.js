(function () {
  'use strict';
  try {
    if (!window.cc) throw new Error('Cocos 2.4.7 runtime is missing.');
    cc.ENGINE_VERSION = '2.4.7';
    window.Standalone.isolateStorage();
    window.boot();
  } catch (error) {
    console.error(error);
    var label = document.getElementById('boot-error');
    label.hidden = false;
    label.textContent = '启动失败，请检查安装资源。';
  }
}());
