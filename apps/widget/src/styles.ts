/**
 * The panel, laid out as customer-messaging widgets such as Tidio made familiar: a tall header in the website's
 * colour, rounded bubbles with the teammate's initial beside them, and a message box with round icon buttons.
 * Dark mode is black and neutral grey; only the website's colour stays coloured. See docs/architecture/design-system.md.
 */
export const CHAT_CSS = `
:host{--oc-bg:#fff;--oc-fg:#0b1437;--oc-muted:#4d5a80;--oc-line:#e6eaf2;--oc-soft:#f5f7fc;--oc-theirs:#eef1f7;--oc-error:#b42318;--oc-shadow:0 12px 48px rgba(14,26,79,.18),0 2px 8px rgba(14,26,79,.08)}
@media (prefers-color-scheme:dark){:host{--oc-bg:#121214;--oc-fg:#f4f4f5;--oc-muted:#a1a1aa;--oc-line:#27272a;--oc-soft:#000;--oc-theirs:#27272a;--oc-error:#fda29b;--oc-shadow:0 12px 48px rgba(0,0,0,.6),0 0 0 1px #27272a}}
*{box-sizing:border-box}
.oc-panel{position:fixed;right:20px;bottom:96px;z-index:2147483000;width:376px;height:min(680px,calc(100vh - 116px));height:min(680px,calc(100dvh - 116px));display:flex;flex-direction:column;background:var(--oc-bg);color:var(--oc-fg);border-radius:16px;box-shadow:var(--oc-shadow);overflow:hidden;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left}
.oc-panel[hidden]{display:none}
.oc-head{position:relative;z-index:1;display:flex;align-items:center;gap:12px;padding:20px 12px 26px 20px;background:var(--oc-primary);background-image:linear-gradient(135deg,rgba(255,255,255,.18),rgba(0,0,0,.12));color:var(--oc-on-primary);border-radius:0 0 50% 50%/0 0 16px 16px}
.oc-face{position:relative;flex:none;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center}
.oc-face svg{width:24px;height:24px;fill:currentColor}
.oc-face.on::after{content:"";position:absolute;right:0;bottom:1px;width:11px;height:11px;border-radius:50%;background:#32d583;border:2px solid var(--oc-primary)}
.oc-head h2{margin:0;font-size:18px;font-weight:700;letter-spacing:-.01em}
.oc-head p{margin:2px 0 0;font-size:13px;opacity:.9}
.oc-head div{flex:1;min-width:0}
.oc-x{flex:none;width:44px;height:44px;padding:10px;border:0;background:none;color:inherit;cursor:pointer;border-radius:50%;transition:background .15s}
.oc-x svg{display:block;width:100%;height:100%;fill:currentColor}
.oc-x:hover{background:rgba(255,255,255,.18)}
.oc-x:focus-visible,.oc-link:focus-visible,.oc-send:focus-visible,.oc-input:focus-visible,.oc-attach:focus-visible{outline:2px solid var(--oc-primary);outline-offset:1px}
.oc-head .oc-x:focus-visible{outline-color:currentColor;outline-offset:-3px}
.oc-log{flex:1;overflow-y:auto;margin-top:-16px;padding:30px 16px 12px;display:flex;flex-direction:column;gap:4px;overscroll-behavior:contain;background:var(--oc-bg)}
.oc-msg{max-width:80%;display:flex;flex-direction:column;align-items:flex-start;align-self:flex-start;margin-top:2px}
.oc-msg.first{margin-top:10px}
.oc-msg.theirs{position:relative;padding-left:36px}
.oc-msg.mine{align-self:flex-end;align-items:flex-end}
.oc-msg.system{align-self:center;align-items:center;max-width:90%;margin:10px 0;color:var(--oc-muted);font-size:12px}
.oc-ava{position:absolute;left:0;bottom:0;width:28px;height:28px;border-radius:50%;background:var(--oc-primary);color:var(--oc-on-primary);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;text-transform:uppercase}
.oc-who{font-size:12px;color:var(--oc-muted);margin:0 0 4px 4px}
.oc-ai{display:inline-block;margin-left:6px;padding:0 5px;border:1px solid var(--oc-muted);border-radius:4px;font-size:10px;font-weight:600;line-height:16px}
.oc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.oc-bubble{padding:10px 14px;border-radius:18px 18px 18px 4px;background:var(--oc-theirs);white-space:pre-wrap;overflow-wrap:anywhere}
.mine .oc-bubble{border-radius:18px 18px 4px 18px;background:var(--oc-primary);color:var(--oc-on-primary)}
.mine.sending .oc-bubble{opacity:.7}
.system .oc-bubble{background:none;padding:0}
.oc-state{font-size:11px;color:var(--oc-muted);margin:3px 4px 0}
.oc-state.bad{color:var(--oc-error)}
.oc-link{border:0;background:none;padding:0;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}
.oc-older{align-self:center;color:var(--oc-muted);font-size:12px;min-height:32px}
.oc-file{margin-top:4px;font-size:12px;overflow-wrap:anywhere}
.oc-image{display:block;max-width:100%;max-height:220px;margin-bottom:4px;border-radius:12px}
.oc-attach{width:40px;height:40px;flex:none;padding:9px;border:0;border-radius:50%;background:none;color:var(--oc-muted);cursor:pointer;transition:background .15s,color .15s}
.oc-attach:hover{background:var(--oc-soft);color:var(--oc-fg)}
.oc-attach svg,.oc-send svg{display:block;width:100%;height:100%;fill:currentColor}
.oc-challenge{padding:0 16px;max-width:100%;overflow:auto}
.oc-typing{min-height:20px;padding:0 20px 2px;font-size:12px;color:var(--oc-muted)}
.oc-note{margin:0;padding:8px 16px;font-size:12px;color:var(--oc-muted);border-top:1px solid var(--oc-line)}
.oc-note.bad{color:var(--oc-error)}
.oc-compose{display:flex;gap:4px;margin:0 12px 12px;padding:6px 6px 6px 14px;border:1px solid var(--oc-line);border-radius:24px;align-items:flex-end;background:var(--oc-bg);transition:border-color .15s,box-shadow .15s}
.oc-compose:focus-within{border-color:var(--oc-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--oc-primary) 18%,transparent)}
.oc-input{flex:1;min-width:0;padding:8px 10px;border:1px solid var(--oc-line);border-radius:12px;background:var(--oc-bg);color:var(--oc-fg);font:inherit;font-size:16px;line-height:1.3;resize:none}
.oc-compose .oc-input{align-self:center;border:0;padding:8px 2px;max-height:120px;background:none}
.oc-compose .oc-input:focus-visible{outline:none}
.oc-send{min-height:40px;padding:0 16px;border:0;border-radius:12px;background:var(--oc-primary);color:var(--oc-on-primary);font:inherit;font-weight:600;cursor:pointer;transition:opacity .15s,transform .15s}
.oc-compose .oc-send{flex:none;width:40px;height:40px;padding:10px;border-radius:50%}
.oc-send:disabled{opacity:.35;cursor:default}
.oc-form{display:flex;flex-direction:column;gap:10px;margin:0 12px 12px;padding:16px;border:1px solid var(--oc-line);border-radius:16px;background:var(--oc-bg)}
.oc-form p{margin:0;font-weight:600}
.oc-form label{display:flex;flex-direction:column;gap:4px;font-size:12px}
.oc-form label.oc-check{flex-direction:row;align-items:flex-start;gap:6px}
.oc-actions{display:flex;gap:12px;align-items:center}
@media (max-width:640px),(max-height:500px){
.oc-panel{inset:0;width:auto;height:100%;border-radius:0;box-shadow:none;z-index:2147483001;padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
.oc-head{padding-top:calc(16px + env(safe-area-inset-top))}
}
@media (prefers-reduced-motion:no-preference){.oc-panel{animation:oc-in .22s cubic-bezier(.2,.8,.3,1);transform-origin:bottom right}@keyframes oc-in{from{opacity:0;transform:translateY(16px) scale(.96)}}}
`;
