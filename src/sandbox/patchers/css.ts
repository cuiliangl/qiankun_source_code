/**
 * @author Saviio
 * @since 2020-4-19
 */

// https://developer.mozilla.org/en-US/docs/Web/API/CSSRule
enum RuleType {
  // type: rule will be rewrote
  STYLE = 1,
  MEDIA = 4,
  SUPPORTS = 12,

  // type: value will be kept
  IMPORT = 3,
  FONT_FACE = 5,
  PAGE = 6,
  KEYFRAMES = 7,
  KEYFRAME = 8,
}

const arrayify = <T>(list: CSSRuleList | any[]) => {
  return [].slice.call(list, 0) as T[];
};

// 拦截 appendChild 方法 ??
const rawDocumentBodyAppend = HTMLBodyElement.prototype.appendChild;

export class ScopedCSS {
  private static ModifiedTag = 'Symbol(style-modified-qiankun)';

  private sheet: StyleSheet;

  private swapNode: HTMLStyleElement;

  constructor() {
    const styleNode = document.createElement('style');
    // body中增加 style 节点。只有添加到 document 中才能获取styleNode 的 sheet 属性
    rawDocumentBodyAppend.call(document.body, styleNode);

    this.swapNode = styleNode;
    // style的sheet属性
    this.sheet = styleNode.sheet!;
    this.sheet.disabled = true;
  }

  process(styleNode: HTMLStyleElement, prefix: string = '') {
    if (styleNode.textContent !== '') {
      // 以子应用 style 下的内容创建文本节点
      const textNode = document.createTextNode(styleNode.textContent || '');
      // 文本节点添加到 新创建的 style 中
      this.swapNode.appendChild(textNode);
      // 获取 sheet
      const sheet = this.swapNode.sheet as any; // type is missing
      // cssRules 类数组转成真数组
      const rules = arrayify<CSSRule>(sheet?.cssRules ?? []);
      // css 添加前缀
      const css = this.rewrite(rules, prefix);
      // eslint-disable-next-line no-param-reassign

      // 设置 css
      styleNode.textContent = css;

      // cleanup
      // 只清空了 style 的内容，为什么不直接删除style节点呢，留着有啥用？因为ScopedCss是单例模式，如果删除style，在process方法中就获取不到 this.swapNode
      this.swapNode.removeChild(textNode);
      return;
    }

    // 监听style节点，如果 childList 变化了，重新获取添加前缀
    const mutator = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i];

        if (ScopedCSS.ModifiedTag in styleNode) {
          return;
        }

        if (mutation.type === 'childList') {
          const sheet = styleNode.sheet as any;
          const rules = arrayify<CSSRule>(sheet?.cssRules ?? []);
          const css = this.rewrite(rules, prefix);

          // eslint-disable-next-line no-param-reassign
          styleNode.textContent = css;
          // eslint-disable-next-line no-param-reassign
          (styleNode as any)[ScopedCSS.ModifiedTag] = true;
        }
      }
    });

    // since observer will be deleted when node be removed
    // we dont need create a cleanup function manually
    // see https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/disconnect
    mutator.observe(styleNode, { childList: true });
  }

  private rewrite(rules: CSSRule[], prefix: string = '') {
    let css = '';

    rules.forEach((rule) => {
      switch (rule.type) {
        case RuleType.STYLE:
          css += this.ruleStyle(rule as CSSStyleRule, prefix);
          break;
        case RuleType.MEDIA:
          css += this.ruleMedia(rule as CSSMediaRule, prefix);
          break;
        case RuleType.SUPPORTS:
          css += this.ruleSupport(rule as CSSSupportsRule, prefix);
          break;
        default:
          css += `${rule.cssText}`;
          break;
      }
    });

    return css;
  }

  // handle case:
  // .app-main {}
  // html, body {}

  // eslint-disable-next-line class-methods-use-this
  private ruleStyle(rule: CSSStyleRule, prefix: string) {
    const rootSelectorRE = /((?:[^\w\-.#]|^)(body|html|:root))/gm;
    const rootCombinationRE = /(html[^\w{[]+)/gm;

    const selector = rule.selectorText.trim();

    let { cssText } = rule;
    // handle html { ... }
    // handle body { ... }
    // handle :root { ... }
    if (selector === 'html' || selector === 'body' || selector === ':root') {
      return cssText.replace(rootSelectorRE, prefix);
    }

    // handle html body { ... }
    // handle html > body { ... }
    if (rootCombinationRE.test(rule.selectorText)) {
      const siblingSelectorRE = /(html[^\w{]+)(\+|~)/gm;

      // since html + body is a non-standard rule for html
      // transformer will ignore it
      if (!siblingSelectorRE.test(rule.selectorText)) {
        cssText = cssText.replace(rootCombinationRE, '');
      }
    }

    // handle grouping selector, a,span,p,div { ... }
    cssText = cssText.replace(/^[\s\S]+{/, (selectors) =>
      selectors.replace(/(^|,\n?)([^,]+)/g, (item, p, s) => {
        // handle div,body,span { ... }
        if (rootSelectorRE.test(item)) {
          return item.replace(rootSelectorRE, (m) => {
            // do not discard valid previous character, such as body,html or *:not(:root)
            const whitePrevChars = [',', '('];

            if (m && whitePrevChars.includes(m[0])) {
              return `${m[0]}${prefix}`;
            }

            // replace root selector with prefix
            return prefix;
          });
        }

        return `${p}${prefix} ${s.replace(/^ */, '')}`;
      }),
    );

    return cssText;
  }

  // handle case:
  // @media screen and (max-width: 300px) {}
  private ruleMedia(rule: CSSMediaRule, prefix: string) {
    const css = this.rewrite(arrayify(rule.cssRules), prefix);
    return `@media ${rule.conditionText} {${css}}`;
  }

  // handle case:
  // @supports (display: grid) {}
  private ruleSupport(rule: CSSSupportsRule, prefix: string) {
    const css = this.rewrite(arrayify(rule.cssRules), prefix);
    return `@supports ${rule.conditionText} {${css}}`;
  }
}

let processor: ScopedCSS;

export const QiankunCSSRewriteAttr = 'data-qiankun';
export const process = (
  appWrapper: HTMLElement,
  stylesheetElement: HTMLStyleElement | HTMLLinkElement,
  appName: string,
): void => {
  // lazy singleton pattern
  // 单例模式 document.body 下只创建一个style标签用于处理css前缀
  if (!processor) {
    processor = new ScopedCSS();
  }

  if (stylesheetElement.tagName === 'LINK') {
    console.warn('Feature: sandbox.experimentalStyleIsolation is not support for link element yet.');
  }

  const mountDOM = appWrapper;
  if (!mountDOM) {
    return;
  }

  const tag = (mountDOM.tagName || '').toLowerCase();

  if (tag && stylesheetElement.tagName === 'STYLE') {
    // 子应用根结点的前缀 div[data-name="sub-app"]
    const prefix = `${tag}[${QiankunCSSRewriteAttr}="${appName}"]`;
    // stylesheetElement: style节点
    processor.process(stylesheetElement, prefix);
  }
};
