class WindowSnapshot {
  constructor(name) {
    this.name = name;
    this.running = false;
    this.modifySnapshot = {};
    this.windowSnapshot = {};
  }

  active() {
    // 打快找
    Object.keys(window).forEach((key) => {
      this.windowSnapshot[key] = window[key];
    });

    // 变更恢复
    Object.keys(this.modifySnapshot).forEach((key) => {
      window[key] = this.modifySnapshot[key];
    });

    this.running = true;
  }

  inActive() {
    this.modifySnapshot = {};

    // 保存变更
    Object.keys(this.windowSnapshot).forEach((key) => {
      if (this.windowSnapshot[key] !== window[key]) {
        this.modifySnapshot[key] = window[key];
      }
    });

    this.running = false;
  }
}

class ProxySandbox {
  constructor(name) {
    this.name = name;
    this.running = false;

    const fakeWindow = Object.create(null);
    const proxy = new Proxy(fakeWindow, {
      get(target, key) {
        switch (key) {
          case 'window':
          case 'self':
          case 'globalThis':
            return fakeWindow;
          default:
            break;
        }

        if (!target.hasOwnProperty(key) && window.hasOwnProperty(key)) {
          const value = window[key];

          if (typeof value === 'function') {
            return value.bind(window);
          }
          return value;
        }

        return window[key];
      },
      set(target, key, val) {
        if (this.running) {
          target[key] = val;
        }

        return true;
      },
    });

    return proxy;
  }

  active() {
    this.running = true;
  }

  inActive() {
    this.running = false;
  }
}
