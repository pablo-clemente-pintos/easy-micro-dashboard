/* Minimal ANSI → HTML converter: SGR colors/styles only, other sequences dropped. */
(function (global) {
  'use strict';

  // eslint-disable-next-line no-control-regex
  const SEQUENCE = /\u001b\[([0-9;?]*)([A-Za-z@])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]|\u001b[=>78DEHMNOc]/g;
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

  const escapeHtml = (text) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const xterm256 = (index) => {
    if (index < 16) {
      return null;
    }
    if (index >= 232) {
      const level = 8 + (index - 232) * 10;
      return `rgb(${level},${level},${level})`;
    }
    const value = index - 16;
    const channel = (n) => (n === 0 ? 0 : 55 + n * 40);
    return `rgb(${channel(Math.floor(value / 36))},${channel(
      Math.floor(value / 6) % 6,
    )},${channel(value % 6)})`;
  };

  const createState = () => ({
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
  });

  // Returns how many extra params were consumed by an extended color.
  const applyExtendedColor = (state, key, codes, index) => {
    if (codes[index + 1] === 5) {
      const color = codes[index + 2];
      state[key] =
        color < 16 ? { index: color } : { css: xterm256(color) };
      return 2;
    }
    if (codes[index + 1] === 2) {
      const [r, g, b] = codes.slice(index + 2, index + 5);
      state[key] = { css: `rgb(${r},${g},${b})` };
      return 4;
    }
    return 0;
  };

  const applySgr = (state, params) => {
    const codes = params === '' ? [0] : params.split(';').map(Number);

    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];

      if (code === 0) {
        Object.assign(state, createState());
      } else if (code === 1) {
        state.bold = true;
      } else if (code === 2) {
        state.dim = true;
      } else if (code === 3) {
        state.italic = true;
      } else if (code === 4) {
        state.underline = true;
      } else if (code === 22) {
        state.bold = false;
        state.dim = false;
      } else if (code === 23) {
        state.italic = false;
      } else if (code === 24) {
        state.underline = false;
      } else if (code >= 30 && code <= 37) {
        state.fg = { index: code - 30 };
      } else if (code >= 90 && code <= 97) {
        state.fg = { index: code - 90 + 8 };
      } else if (code === 39) {
        state.fg = null;
      } else if (code >= 40 && code <= 47) {
        state.bg = { index: code - 40 };
      } else if (code >= 100 && code <= 107) {
        state.bg = { index: code - 100 + 8 };
      } else if (code === 49) {
        state.bg = null;
      } else if (code === 38 || code === 48) {
        i += applyExtendedColor(state, code === 38 ? 'fg' : 'bg', codes, i);
      }
    }
  };

  const wrap = (state, text) => {
    const classes = [];
    const styles = [];

    if (state.fg) {
      if (state.fg.css) {
        styles.push(`color:${state.fg.css}`);
      } else {
        classes.push(`a-fg${state.fg.index}`);
      }
    }
    if (state.bg) {
      if (state.bg.css) {
        styles.push(`background:${state.bg.css}`);
      } else {
        classes.push(`a-bg${state.bg.index}`);
      }
    }
    if (state.bold) classes.push('a-bold');
    if (state.dim) classes.push('a-dim');
    if (state.italic) classes.push('a-italic');
    if (state.underline) classes.push('a-underline');

    const content = escapeHtml(text.replace(CONTROL, ''));

    if (!classes.length && !styles.length) {
      return content;
    }

    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
    const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
    return `<span${classAttr}${styleAttr}>${content}</span>`;
  };

  const toHtml = (line) => {
    const state = createState();
    let html = '';
    let last = 0;
    let match;

    SEQUENCE.lastIndex = 0;

    while ((match = SEQUENCE.exec(line)) !== null) {
      if (match.index > last) {
        html += wrap(state, line.slice(last, match.index));
      }
      if (match[2] === 'm') {
        applySgr(state, match[1]);
      }
      last = SEQUENCE.lastIndex;
    }

    if (last < line.length) {
      html += wrap(state, line.slice(last));
    }

    return html;
  };

  const strip = (line) => line.replace(SEQUENCE, '').replace(CONTROL, '');

  global.Ansi = { strip, toHtml };
})(window);
