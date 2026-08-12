/* ============================================================
   反诈守护APP 原型 · 交互逻辑（纯前端 SPA，无后端依赖）
   ============================================================ */

/* ---------- 全局状态 ---------- */
const S = {
  agreed: false,
  role: null,                       // 'seeker' | 'guardian'
  loginTab: 'onekey',
  seeker: { name: '张阿姨', points: 260 },
  guard: {
    authed: false, name: '李守护者', level: 3, helps: 68, score: 4.6,
    credit: 82, points: 1280, online: false,
    tags: ['冒充客服退款类', '网络刷单类', '冒充公检法类'],
  },
  helpType: null,                   // 当前求助类型
  lastHelpTime: 0,                  // 上次发起求助的时间戳（频率限制：两次间隔≥60秒）
  addr: JSON.parse(JSON.stringify(DEFAULT_ADDR)),
  orders: [
    { id: 'o1', no: 'SO20260803001', name: '反诈宣传定制雨伞', icon: 'i-umbrella', color: '#185FA5', points: 800, status: '已发货', time: '08-03 10:22',
      logistics: [
        { t: '今天 09:12', d: '【北京市】快件已到达朝阳幸福里营业点，派送员正在派送' },
        { t: '昨天 18:40', d: '【北京市】快件到达北京转运中心' },
        { t: '08-03 10:30', d: '【杭州市】商家已发货，顺丰速运 SF1386688992' },
      ] },
    { id: 'o2', no: 'SO20260721002', name: '《全民反诈手册》', icon: 'i-book', color: '#0B7285', points: 300, status: '已完成', time: '07-21 15:08' },
    { id: 'o3', no: 'SO20260712003', name: '守护者定制马克杯', icon: 'i-cup', color: '#B4610E', points: 600, status: '已取消', time: '07-12 09:41' },
  ],
  msgs: JSON.parse(JSON.stringify(MESSAGES)),
  records: JSON.parse(JSON.stringify(HELP_RECORDS)),
  orderTab: '全部',
  mallCat: '全部',
  typeSearch: '',
  loginVia: 'wechat',              // 第三方登录方式：wechat / apple
  account: {
    phone: '138****8888',          // 已绑定手机号
    wechat: true,                  // 微信绑定状态
    apple: false,                  // 苹果账号绑定状态
  },
  newsPage: 0,                     // 资讯列表当前页
  newsLoading: false,              // 资讯列表加载中
  newsNoMore: false,               // 资讯列表无更多
};

let curProduct = null;
let reportType = null;              // 举报线索选中的诈骗类型
let complaintType = null;           // 投诉建议选中的反馈类型
let quiz = null;                    // 测评会话
let callTimerSec = 0;
let timers = [];
let stack = [];                     // 导航栈
let newsPulling = false;            // 资讯列表下拉刷新中

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const app = $('#app');
const ic = (id, cls) => `<svg class="ic ${cls || ''}"><use href="#${id}"/></svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function tick(fn, ms) { const id = setTimeout(fn, ms); timers.push(id); return id; }
function every(fn, ms) { const id = setInterval(fn, ms); timers.push(id); return id; }
function clearTimers() { timers.forEach(id => { clearTimeout(id); clearInterval(id); }); timers = []; }

function toast(msg, icon) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = (icon ? ic(icon) : '') + `<span>${msg}</span>`;
  $('#toast-root').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2200);
}

function openModal(html, sheet) {
  const m = document.createElement('div');
  m.className = 'mask' + (sheet ? ' sheet' : '');
  m.innerHTML = html;
  m.addEventListener('click', e => { if (e.target === m && !m.dataset.lock) closeModal(m); });
  $('#modal-root').appendChild(m);
  return m;
}
function closeModal(m) { (m || $('#modal-root .mask:last-child'))?.remove(); }
function closeAllModals() { $('#modal-root').innerHTML = ''; }

function confirmDlg(title, sub, okText, onOk, danger) {
  const m = openModal(`
    <div class="dialog">
      <h3>${title}</h3>
      <div class="d-sub">${sub}</div>
      <div class="d-btns">
        <button class="btn btn-plain" data-x>再想想</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okText}</button>
      </div>
    </div>`);
  m.querySelector('[data-x]').onclick = () => closeModal(m);
  m.querySelector('[data-ok]').onclick = () => { closeModal(m); onOk && onOk(); };
}

/* 求助频率限制弹窗（PRD 7：两次发起求助最小间隔 1 分钟） */
function showRateLimitDlg(remaining) {
  let sec = remaining;
  const m = openModal(`
    <div class="dialog">
      <div class="d-icon" style="background:var(--orange-l);color:var(--orange-d)">${ic('i-clock')}</div>
      <h3>操作过于频繁</h3>
      <div class="d-sub">为防止恶意频繁发起求助影响系统匹配稳定性与守护者资源，两次发起求助需间隔 <b>1 分钟</b>。<br>请等待 <b id="rlDlgSec">${sec}</b> 秒后再试。</div>
      <div class="d-btns">
        <button class="btn btn-plain" data-bk>知道了</button>
        <button class="btn btn-primary" id="rlDlgGo" disabled style="opacity:.55">请等待 ${sec}s</button>
      </div>
    </div>`);
  m.dataset.lock = '1';
  m.querySelector('[data-bk]').onclick = () => { clearTimers(); closeModal(m); };
  const goBtn = m.querySelector('#rlDlgGo');
  const iv = every(() => {
    sec--;
    const el = m.querySelector('#rlDlgSec');
    if (el) el.textContent = sec;
    if (sec <= 0) {
      clearTimers();
      goBtn.disabled = false;
      goBtn.style.opacity = '1';
      goBtn.textContent = '立即发起求助';
      goBtn.classList.remove('btn-primary');
      goBtn.classList.add('btn-danger');
      goBtn.onclick = () => { closeModal(m); $('#launchHelp').click(); };
    } else {
      goBtn.textContent = `请等待 ${sec}s`;
    }
  }, 1000);
}

/* ---------- 路由 ---------- */
function go(id, params, keepTimers) {
  if (!keepTimers) { clearTimers(); closeAllModals(); }
  const cur = stack[stack.length - 1];
  if (cur !== id) stack.push(id);
  render(id, params);
}
function back(fallback) {
  stack.pop();
  const id = stack.pop() || fallback || (S.role === 'guardian' ? 'guard' : 'home');
  go(id);
}
function resetTo(id) { clearTimers(); closeAllModals(); stack = [id]; render(id); }

function render(id, params) {
  const fn = SCREENS[id];
  if (!fn) return;
  app.innerHTML = fn.html(params || {});
  $('#statusbar').classList.toggle('on-dark', !!fn.dark);
  renderTabbar(fn.tab || null);
  fn.mount && fn.mount(params || {});
  app.querySelector('.screen')?.scrollTo(0, 0);
}

/* ---------- 底部标签栏 ---------- */
function renderTabbar(active) {
  const bar = $('#tabbar');
  if (!active) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const unread = S.msgs.filter(m => m.unread).length;
  const tabs = S.role === 'guardian'
    ? [['guard', 'i-radar', '工作台'], ['mall', 'i-gift', '积分商城'], ['messages', 'i-msg', '消息'], ['profile', 'i-user', '我的']]
    : [['home', 'i-home', '首页'], ['messages', 'i-msg', '消息'], ['profile', 'i-user', '我的']];
  bar.innerHTML = tabs.map(([id, icon, label]) => `
    <button class="tab-item ${active === id ? 'active' : ''}" data-tab="${id}">
      ${ic(icon)}${label}
      ${id === 'messages' && unread ? `<span class="tab-dot">${unread}</span>` : ''}
    </button>`).join('');
  bar.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => resetTo(b.dataset.tab));
}

/* ---------- 通用片段 ---------- */
const navbar = (title, opts = {}) => `
  <div class="navbar ${opts.cls || ''}">
    <button class="nb-back" data-back>${ic('i-left')}</button>
    <div class="nb-title">${title}</div>
    ${opts.right || '<span style="width:38px"></span>'}
  </div>`;

function bindBack(root) {
  root.querySelectorAll('[data-back]').forEach(b => b.onclick = () => back());
}

const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* ============================================================
   页面定义
   ============================================================ */
const SCREENS = {};

/* ============ 1. 登录页 ============ */
SCREENS.login = {
  html() {
    return `
    <div class="screen">
      <div class="login-hero">
        <div class="login-logo"><img src="assets/logo.svg" alt="反诈守护"><b>反诈守护</b></div>
        <h1>黄金 5 分钟<br>真人守护，即时反诈</h1>
        <p>遭遇疑似诈骗，一键视频连线反诈守护者<br>已拦截诈骗转账 <b>12,600+</b> 次</p>
      </div>
      <div class="login-body">
        <div class="login-tabs">
          <button data-ltab="onekey" class="${S.loginTab === 'onekey' ? 'on' : ''}">手机号一键登录</button>
          <button data-ltab="code" class="${S.loginTab === 'code' ? 'on' : ''}">验证码登录</button>
        </div>
        <div id="loginPane"></div>
        <div class="login-other">
          <div class="divider">其他登录方式</div>
          <div class="login-social">
            <button class="wx-btn" id="wxLogin" title="微信登录">${ic('i-wechat')}</button>
            <button class="apple-btn" id="appleLogin" title="Apple 登录">${ic('i-apple')}</button>
          </div>
          <div class="login-agree">
            <span class="agree-check ${S.agreed ? 'on' : ''}" id="agreeCk">${ic('i-check')}</span>
            <span>我已阅读并同意<a href="javascript:void 0" data-pp>《隐私政策》</a>与<a href="javascript:void 0" data-pp>《用户协议》</a>，并授权本应用获取本机号码用于登录</span>
          </div>
        </div>
      </div>
    </div>`;
  },
  mount() {
    document.querySelectorAll('[data-ltab]').forEach(b => b.onclick = () => { S.loginTab = b.dataset.ltab; render('login'); });
    $('#agreeCk').onclick = e => { S.agreed = !S.agreed; e.currentTarget.classList.toggle('on', S.agreed); };
    document.querySelectorAll('[data-pp]').forEach(a => a.onclick = showPrivacy);
    $('#wxLogin').onclick = () => { if (!checkAgree()) return; S.loginVia = 'wechat'; go('bind-phone'); };
    $('#appleLogin').onclick = () => { if (!checkAgree()) return; S.loginVia = 'apple'; go('bind-phone'); };
    renderLoginPane();
  }
};

function renderLoginPane() {
  const pane = $('#loginPane');
  if (S.loginTab === 'onekey') {
    pane.innerHTML = `
      <div class="phone-mock">
        ${ic('i-phone')}
        <div><b>138****8888</b><span>中国移动认证 · 本机号码</span></div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="onekeyBtn">本机号码一键登录</button>
      <p style="text-align:center;font-size:var(--fs-xs);color:var(--ink-4);margin-top:14px">一键登录失败？可切换至验证码登录</p>`;
    $('#onekeyBtn').onclick = () => {
      if (!checkAgree()) return;
      const btn = $('#onekeyBtn');
      btn.textContent = '运营商取号授权中…'; btn.disabled = true;
      tick(() => { btn.textContent = '登录成功，正在进入…'; tick(afterLogin, 700); }, 1100);
    };
  } else {
    pane.innerHTML = `
      <div class="form-field" style="margin:0 0 14px"><input class="input" id="phoneInput" type="tel" maxlength="11" placeholder="请输入手机号"></div>
      <div class="form-field" style="margin:0 0 20px">
        <div class="input-row">
          <input class="input" id="codeInput" type="tel" maxlength="6" placeholder="请输入6位验证码">
          <button class="code-btn" id="codeBtn">获取验证码</button>
        </div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="codeLoginBtn">登 录</button>`;
    let cool = 0;
    $('#codeBtn').onclick = e => {
      const phone = $('#phoneInput').value.trim();
      if (!/^1\d{10}$/.test(phone)) return toast('请输入正确的 11 位手机号', 'i-alert');
      cool = 60;
      e.target.disabled = true;
      e.target.textContent = `${cool}s 后重发`;
      toast('验证码已发送（演示码：246810）', 'i-check');
      every(() => {
        cool--;
        if (cool <= 0) { $('#codeBtn').disabled = false; $('#codeBtn').textContent = '重新获取'; clearTimers(); }
        else $('#codeBtn').textContent = `${cool}s 后重发`;
      }, 1000);
    };
    $('#codeLoginBtn').onclick = () => {
      if (!checkAgree()) return;
      if (!/^1\d{10}$/.test($('#phoneInput').value.trim())) return toast('请输入正确的手机号', 'i-alert');
      if (!/^\d{6}$/.test($('#codeInput').value.trim())) return toast('请输入 6 位数字验证码', 'i-alert');
      toast('登录成功', 'i-check');
      tick(afterLogin, 500);
    };
  }
}

function checkAgree() {
  if (!S.agreed) { toast('请先勾选并同意《隐私政策》与《用户协议》', 'i-alert'); return false; }
  return true;
}
function afterLogin() { resetTo(S.role ? (S.role === 'guardian' ? 'guard' : 'home') : 'role'); }

/* 隐私政策弹窗（首次启动 & 协议链接共用） */
function showPrivacy(fromBoot) {
  const m = openModal(`
    <div class="dialog" style="text-align:left">
      <h3 style="text-align:center">隐私政策与用户协议</h3>
      <div class="privacy-text">
        <h4>一、信息收集范围</h4>
        为提供即时反诈守护服务，我们会收集：手机号（用于登录认证）、设备信息（用于安全风控）；守护者另需提供实名信息与人脸特征（用于资质认证，加密存储）。
        <h4>二、通话录音与转写</h4>
        守护通话将全程录音并由 ASR 引擎转写为文字存档，仅用于服务质量监督与合规审查，保留期限不少于 180 天，查阅权限仅限平台合规人员。
        <h4>三、信息保护</h4>
        我们遵循《个人信息保护法》，实名信息加密存储，通话数据采用 AES-256 加密传输。您有权随时导出或删除个人数据。
        <h4>四、您的权利</h4>
        您可拒绝授权摄像头/麦克风权限，但将无法使用视频守护功能；可在「我的-设置」中管理授权与注销账号。
      </div>
      <div class="d-btns">
        <button class="btn btn-plain" data-no>暂不同意</button>
        <button class="btn btn-primary" data-yes>同意并继续</button>
      </div>
    </div>`);
  m.dataset.lock = fromBoot ? '1' : '';
  m.querySelector('[data-yes]').onclick = () => { S.agreed = true; closeModal(m); if (fromBoot) go('login'); else render('login'); };
  m.querySelector('[data-no]').onclick = () => { closeModal(m); toast('需同意协议后方可使用本应用', 'i-alert'); if (fromBoot) tick(() => showPrivacy(true), 900); };
}

/* ============ 2. 第三方登录 · 关联手机号 ============ */
SCREENS['bind-phone'] = {
  html() {
    const isApple = S.loginVia === 'apple';
    const viaName = isApple ? 'Apple' : '微信';
    const viaIcon = isApple ? 'i-apple' : 'i-wechat';
    const viaColor = isApple ? '#1A1A1A' : '#07C160';
    return `
    <div class="screen">
      ${navbar('关联手机号')}
      <div style="padding:34px 24px;text-align:center">
        <div style="width:76px;height:76px;border-radius:50%;background:${viaColor};color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">${ic(viaIcon)}</div>
        <h2 style="font-size:var(--fs-xl)">${viaName}授权成功</h2>
        <p style="color:var(--ink-3);font-size:var(--fs-md);margin-top:10px;line-height:1.7">首次使用${viaName}登录<br>需关联手机号完成账号绑定</p>
      </div>
      <div class="form-field"><label>手机号</label><input class="input" id="bpPhone" type="tel" maxlength="11" placeholder="请输入手机号"></div>
      <div class="form-field"><label>短信验证码</label>
        <div class="input-row">
          <input class="input" id="bpCode" type="tel" maxlength="6" placeholder="6位验证码">
          <button class="code-btn" id="bpCodeBtn">获取验证码</button>
        </div>
      </div>
      <div style="padding:8px 16px"><button class="btn btn-primary btn-lg btn-block" id="bindBtn">绑定并登录</button></div>
    </div>`;
  },
  mount() {
    bindBack(app);
    let cool = 0;
    $('#bpCodeBtn').onclick = e => {
      if (!/^1\d{10}$/.test($('#bpPhone').value.trim())) return toast('请输入正确的 11 位手机号', 'i-alert');
      cool = 60; e.target.disabled = true;
      toast('验证码已发送（演示码：246810）', 'i-check');
      every(() => {
        cool--;
        if (cool <= 0) { $('#bpCodeBtn').disabled = false; $('#bpCodeBtn').textContent = '重新获取'; clearTimers(); }
        else $('#bpCodeBtn').textContent = `${cool}s 后重发`;
      }, 1000);
    };
    $('#bindBtn').onclick = () => {
      if (!/^1\d{10}$/.test($('#bpPhone').value.trim())) return toast('请输入正确的手机号', 'i-alert');
      if (!/^\d{6}$/.test($('#bpCode').value.trim())) return toast('请输入 6 位数字验证码', 'i-alert');
      toast('绑定成功，登录中…', 'i-check');
      tick(() => resetTo('role'), 600);
    };
  }
};

/* ============ 3. 身份选择 ============ */
SCREENS.role = {
  html() {
    return `
    <div class="screen">
      <div class="role-wrap">
        <h1>请选择您的身份</h1>
        <p>不同身份将为您提供不同的功能服务<br>身份可随时在「我的」中切换</p>
        <button class="role-card" data-role="seeker">
          <div class="rc-icon" style="background:linear-gradient(135deg,#1E6FC0,#185FA5)">${ic('i-alert')}</div>
          <div style="flex:1">
            <h2>我是求助者</h2>
            <p>遭遇疑似诈骗时，一键发起视频求助，黄金5分钟内获得真人守护</p>
          </div>
          ${ic('i-right', 'rc-arrow')}
        </button>
        <button class="role-card" data-role="guardian">
          <div class="rc-icon" style="background:linear-gradient(135deg,#12997A,#0F6E56)">${ic('i-shield')}</div>
          <div style="flex:1">
            <h2>我是守护者</h2>
            <p>需完成实名认证与能力测评，在线接单守护他人，赚取积分兑换好礼</p>
          </div>
          ${ic('i-right', 'rc-arrow')}
        </button>
        <div class="proto-note" style="margin:10px 0 0">原型提示：选择「求助者」直接进入首页；选择「守护者」将体验完整的三步认证流程（实名活体 → 能力标签 → 能力测评）。</div>
      </div>
    </div>`;
  },
  mount() {
    app.querySelectorAll('[data-role]').forEach(b => b.onclick = () => {
      const role = b.dataset.role;
      if (role === 'seeker') { S.role = 'seeker'; toast('已选择求助者身份', 'i-check'); resetTo('home'); }
      else if (S.guard.authed) { S.role = 'guardian'; resetTo('guard'); }
      else { toast('首次成为守护者，请完成三步认证', 'i-alert'); go('auth-name'); }
    });
  }
};

/* ============ 4. 守护者认证 · 实名活体 ============ */
SCREENS['auth-name'] = {
  html() {
    return `
    <div class="screen">
      ${navbar('守护者认证')}
      <div class="steps">
        <div class="step cur"><i>1</i><span>实名活体</span></div>
        <div class="step"><i>2</i><span>能力标签</span></div>
        <div class="step"><i>3</i><span>能力测评</span></div>
      </div>
      <div id="authStage" style="flex:1;display:flex;flex-direction:column"></div>
    </div>`;
  },
  mount() {
    bindBack(app);
    showRealnameForm();
  }
};

function showRealnameForm() {
  $('#authStage').innerHTML = `
    <div style="padding:20px 0 0">
      <div class="form-field"><label>真实姓名</label><input class="input" id="rnName" placeholder="请输入与身份证一致的姓名"></div>
      <div class="form-field"><label>身份证号</label><input class="input" id="rnId" maxlength="18" placeholder="请输入18位身份证号"></div>
      <div class="proto-note">实名信息将加密存储，仅用于守护者资质审核（PRD 4.4.2）。原型中身份信息不做真实校验。</div>
      <div style="padding:14px 16px"><button class="btn btn-primary btn-lg btn-block" id="toFace">下一步：活体检测</button></div>
    </div>`;
  $('#toFace').onclick = () => {
    if (!$('#rnName').value.trim()) return toast('请输入真实姓名', 'i-alert');
    if (!/^\d{17}[\dXx]$/.test($('#rnId').value.trim())) return toast('请输入正确的 18 位身份证号', 'i-alert');
    showFaceScan();
  };
}

function showFaceScan() {
  const steps = ['请正对屏幕，保持光线充足', '请眨眨眼', '请张张嘴', '请缓慢点头'];
  let i = 0;
  $('#authStage').innerHTML = `
    <div style="padding:16px 0 0;flex:1;display:flex;flex-direction:column">
      <div class="face-scan" id="faceScan">
        <div class="face-ring"></div>
        ${ic('i-face')}
        <div class="scan-line"></div>
      </div>
      <div class="face-tip" id="faceTip">${steps[0]}</div>
      <div style="margin:auto 16px 26px;display:flex;gap:12px">
        <button class="btn btn-plain" id="faceFail" style="flex:1">模拟认证失败</button>
        <button class="btn btn-primary" id="faceSkip" style="flex:1">跳过演示</button>
      </div>
    </div>`;
  const iv = every(() => {
    i++;
    if (i < steps.length) $('#faceTip').textContent = steps[i];
    else faceSuccess();
  }, 1700);
  const faceSuccess = () => {
    clearTimers();
    $('#faceScan').classList.add('done');
    $('#faceScan').innerHTML = `<div class="face-ring" style="border-color:var(--green);opacity:.5"></div>${ic('i-check')}`;
    $('#faceScan').querySelector('.ic').style.color = 'var(--green)';
    $('#faceTip').innerHTML = '<span style="color:var(--green)">活体检测通过</span>';
    toast('实名认证成功', 'i-check');
    tick(() => go('auth-tags'), 900);
  };
  $('#faceSkip').onclick = faceSuccess;
  $('#faceFail').onclick = () => {
    clearTimers();
    const m = openModal(`
      <div class="dialog">
        <div class="d-icon" style="background:var(--red-l);color:var(--red)">${ic('i-close')}</div>
        <h3>认证失败</h3>
        <div class="d-sub">活体检测未通过，请确保光线充足<br>并按提示完成动作</div>
        <div class="d-btns">
          <button class="btn btn-plain" data-exit>退出</button>
          <button class="btn btn-primary" data-re>重新认证</button>
        </div>
      </div>`);
    m.querySelector('[data-re]').onclick = () => { closeModal(m); showFaceScan(); };
    m.querySelector('[data-exit]').onclick = () => { closeModal(m); resetTo('role'); };
  };
}

/* ============ 5. 守护者认证 · 能力标签 ============ */
SCREENS['auth-tags'] = {
  html() {
    return `
    <div class="screen">
      ${navbar('守护者认证')}
      <div class="steps">
        <div class="step done"><i>${'✓'}</i><span>实名活体</span></div>
        <div class="step cur"><i>2</i><span>能力标签</span></div>
        <div class="step"><i>3</i><span>能力测评</span></div>
      </div>
      <div style="padding:18px 22px 6px">
        <h2 style="font-size:var(--fs-xl)">选择您擅长的反诈领域</h2>
        <p style="color:var(--ink-3);font-size:var(--fs-md);margin-top:8px;line-height:1.7">标签与求助者发起的诈骗类型同源同步，<br>系统将按标签为您精准派单。<b style="color:var(--blue)">至少选择 1 个</b>。</p>
      </div>
      <div class="tag-grid" id="tagGrid">
        ${FRAUD_TYPES.map(t => `<button class="tag-pick" data-tag="${t.name}">${ic('i-check')}${t.name}</button>`).join('')}
      </div>
      <div class="bottom-cta"><button class="btn btn-primary btn-lg btn-block" id="tagNext" disabled>下一步（已选 <span id="tagCount">0</span> 个）</button></div>
    </div>`;
  },
  mount() {
    bindBack(app);
    const picked = new Set();
    app.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => {
      const t = b.dataset.tag;
      picked.has(t) ? picked.delete(t) : picked.add(t);
      b.classList.toggle('on');
      $('#tagCount').textContent = picked.size;
      $('#tagNext').disabled = picked.size === 0;
    });
    $('#tagNext').onclick = () => {
      S.pendingTags = [...picked];
      startQuiz('register');
    };
  }
};

/* ============ 6. 能力测评（注册 / 添加标签共用） ============ */
function startQuiz(mode) {
  const pool = [...QUIZ_POOL].sort(() => Math.random() - .5).slice(0, 5);
  quiz = { mode, pool, idx: 0, answers: [], results: [] };
  go('auth-quiz');
}

SCREENS['auth-quiz'] = {
  html() {
    const q = quiz.pool[quiz.idx];
    return `
    <div class="screen">
      ${navbar(quiz.mode === 'register' ? '守护者认证 · 能力测评' : '标签能力测评')}
      <div class="quiz-head">
        <div style="display:flex;font-size:var(--fs-sm);color:var(--ink-3);margin-bottom:8px">
          <span>第 <b style="color:var(--blue)">${quiz.idx + 1}</b> / ${quiz.pool.length} 题</span>
          <span style="margin-left:auto">合格线：答对 ≥4 题（80%）</span>
        </div>
        <div class="pbar"><i style="width:${(quiz.idx / quiz.pool.length) * 100}%"></i></div>
      </div>
      <div class="quiz-q">${q.q}</div>
      <div class="quiz-opts" id="quizOpts">
        ${q.opts.map((o, i) => `
          <button class="quiz-opt" data-opt="${i}">
            <span class="qo-key">${'ABCD'[i]}</span><span>${o}</span>
          </button>`).join('')}
      </div>
      <div class="bottom-cta"><button class="btn btn-primary btn-lg btn-block" id="quizNext" disabled>${quiz.idx === quiz.pool.length - 1 ? '提交测评' : '下一题'}</button></div>
    </div>`;
  },
  mount() {
    let picked = -1;
    app.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
      app.querySelectorAll('.quiz-opt').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      picked = +b.dataset.opt;
      $('#quizNext').disabled = false;
    });
    $('#quizNext').onclick = () => {
      const q = quiz.pool[quiz.idx];
      quiz.answers.push(picked);
      quiz.results.push(picked === q.ans);
      if (quiz.idx < quiz.pool.length - 1) { quiz.idx++; render('auth-quiz'); }
      else go('auth-result');
    };
  }
};

/* ============ 7. 测评结果 ============ */
SCREENS['auth-result'] = {
  html() {
    const right = quiz.results.filter(Boolean).length;
    const pass = right >= 4;
    quiz.pass = pass;
    return `
    <div class="screen">
      <div class="result-wrap">
        <div class="result-badge" style="background:${pass ? 'linear-gradient(135deg,#12997A,#0F6E56)' : 'linear-gradient(135deg,#C84B3C,#A32D2D)'}">
          ${ic(pass ? 'i-check' : 'i-close')}
        </div>
        <h1 style="font-size:var(--fs-2xl)">${pass ? '测评通过！' : '测评未通过'}</h1>
        <p style="color:var(--ink-3);margin-top:12px;font-size:var(--fs-md);line-height:1.8">
          答对 <b style="color:${pass ? 'var(--green)' : 'var(--red)'};font-size:var(--fs-xl)">${right}</b> / ${quiz.pool.length} 题
          ${pass ? (quiz.mode === 'register' ? '<br>恭喜您成为认证守护者，奖励 <b style="color:var(--gold)">+100 积分</b>' : '<br>新能力标签已生效') : '<br>正确率需达到 80%，请复习后再来挑战'}
        </p>
        <div style="width:100%;margin-top:22px">
          ${quiz.pool.map((q, i) => `
            <div style="display:flex;gap:10px;align-items:flex-start;text-align:left;background:var(--card);border-radius:12px;padding:12px 14px;margin-bottom:8px;box-shadow:var(--sh-sm)">
              <span class="tag-mini ${quiz.results[i] ? 'tag-green' : 'tag-red'}" style="flex:none;margin-top:2px">${quiz.results[i] ? '正确' : '错误'}</span>
              <div style="font-size:var(--fs-sm);line-height:1.6;color:var(--ink-2)">
                ${q.q}
                ${!quiz.results[i] ? `<div style="color:var(--ink-3);margin-top:4px">解析：${q.tip}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
        <div style="width:100%;margin-top:auto;padding-top:18px">
          ${pass
            ? `<button class="btn btn-green btn-lg btn-block" id="resultOk">${quiz.mode === 'register' ? '开启守护之旅' : '完成'}</button>`
            : `<button class="btn btn-primary btn-lg btn-block" id="resultRetry">重新测试</button>
               <button class="btn btn-plain btn-block" style="margin-top:12px" id="resultQuit">返回</button>`}
        </div>
      </div>
    </div>`;
  },
  mount() {
    const ok = $('#resultOk');
    if (ok) ok.onclick = () => {
      if (quiz.mode === 'register') {
        S.guard.authed = true;
        S.guard.tags = [...new Set([...S.guard.tags, ...S.pendingTags])];
        S.guard.points += 100;
        S.role = 'guardian';
        resetTo('guard');
      } else {
        S.guard.tags = [...new Set([...S.guard.tags, S.pendingTags[0]])];
        toast('能力标签已生效', 'i-check');
        resetTo('tags-manage');
      }
    };
    const re = $('#resultRetry');
    if (re) re.onclick = () => startQuiz(quiz.mode);
    const quit = $('#resultQuit');
    if (quit) quit.onclick = () => resetTo(quiz.mode === 'register' ? 'auth-tags' : 'tags-manage');
  }
};

/* ============ 8. 求助者首页 ============ */
SCREENS.home = {
  tab: 'home',
  html() {
    return `
    <div class="screen has-tab">
      <div class="home-hero">
        <div class="hh-top">
          <div><div class="hh-hello">您好，</div><div class="hh-name">${S.seeker.name}</div></div>
          <button class="hh-bell" id="homeBell">${ic('i-msg')}<span class="dot"></span></button>
        </div>
        <h1>拿不准是不是诈骗？<br>别转钱，先问问守护者</h1>
        <p>96110 联名反诈平台 · 真人视频在线守护</p>
      </div>
      <div class="sos-card">
        <button class="sos-btn" id="sosBtn">${ic('i-video')}获取反诈守护</button>
        <div class="sos-note">${ic('i-shield')}平均 23 秒接通 · 全程免费 · 通话录音保障权益</div>
      </div>
      <div class="quick-grid">
        <button class="quick-item" data-q="records"><span class="qi" style="background:var(--blue-l);color:var(--blue)">${ic('i-doc')}</span>求助记录</button>
        <button class="quick-item" data-q="class"><span class="qi" style="background:var(--green-l);color:var(--green)">${ic('i-book')}</span>反诈课堂</button>
        <button class="quick-item" data-q="report"><span class="qi" style="background:var(--gold-l);color:var(--gold)">${ic('i-megaphone')}</span>举报线索</button>
        <button class="quick-item" data-q="messages"><span class="qi" style="background:var(--red-l);color:var(--red)">${ic('i-msg')}</span>我的消息</button>
      </div>
      <div class="notice-bar">${ic('i-alert')}预警：近期"冒充客服退款"诈骗高发，凡要求共享屏幕的都是骗子！</div>
      <div class="sec-title">反诈资讯<span class="more" data-q="news-list">更多${ic('i-right')}</span></div>
      <div class="fraud-news">
        ${NEWS.slice(0, 3).map(n => `
          <button class="news-item" data-news="${n.id}">
            <div class="news-cover" style="background:${n.color}">${ic(n.icon)}</div>
            <div class="news-body"><div class="news-title">${n.title}</div><div class="news-meta">${n.meta}</div></div>
          </button>`).join('')}
      </div>
    </div>`;
  },
  mount() {
    $('#sosBtn').onclick = () => go('help-types');
    $('#homeBell').onclick = () => resetTo('messages');
    app.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const k = b.dataset.q;
      if (k === 'class') return toast('反诈课堂为 V2 内容模块，原型暂未展开', 'i-book');
      if (k === 'report') return go('report-clue');
      if (k === 'news-list') return go('news-list');
      resetTo(k);
    });
    app.querySelectorAll('[data-news]').forEach(b => b.onclick = () => go('news-detail', { id: b.dataset.news }));
  }
};

/* ============ 9. 选择诈骗类型 ============ */
SCREENS['help-types'] = {
  html() {
    const kw = S.typeSearch.trim();
    const list = FRAUD_TYPES.filter(t => !kw || t.name.includes(kw) || t.desc.includes(kw));
    /* 频率限制：计算距上次发起求助的剩余秒数 */
    const rlElapsed = S.lastHelpTime > 0 ? Math.floor((Date.now() - S.lastHelpTime) / 1000) : 999;
    const rlRemain = Math.max(0, 60 - rlElapsed);
    const rlActive = rlRemain > 0;
    return `
    <div class="screen">
      ${navbar('选择遇到的诈骗类型')}
      <div id="typeList" style="flex:1">
        ${list.length ? list.map(t => `
          <button class="type-card ${S.helpType === t.id ? 'on' : ''}" data-type="${t.id}">
            <div class="tc-icon" style="background:${t.color}">${ic(t.icon)}</div>
            <div style="flex:1;min-width:0">
              <h3>${t.name}${t.hot ? ' <span class="tag-mini tag-red">高发</span>' : ''}</h3>
              <p>${t.desc}</p>
            </div>
            <span class="tc-check">${ic('i-check')}</span>
          </button>`).join('')
        : `<div class="empty">${ic('i-search')}<p>未找到相关类型，可选择"其他诈骗类型"</p></div>`}
      </div>
      ${rlActive ? `
      <div class="rate-limit-banner" id="rlBanner">
        ${ic('i-clock')}
        <div style="flex:1">
          <b>求助频率限制</b>
          <p>为防止恶意频繁发起求助，两次发起需间隔 1 分钟，请等待 <b id="rlCount">${rlRemain}</b> 秒</p>
        </div>
      </div>` : ''}
      <div class="bottom-cta">
        <button class="btn btn-danger btn-lg btn-block" id="launchHelp" ${S.helpType ? '' : 'disabled'}>
          ${ic('i-video')}${rlActive ? `请等待 ${rlRemain}s 后发起` : '立即发起视频求助'}
        </button>
        <button style="margin-top:10px;font-size:var(--fs-xs);color:var(--ink-4);text-decoration:underline" id="demoRateLimit">演示：模拟刚发起过求助（触发频率限制）</button>
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    app.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { S.helpType = b.dataset.type; render('help-types'); });

    /* 频率限制：若处于限制中，启动倒计时刷新横幅与按钮 */
    const rlElapsed0 = S.lastHelpTime > 0 ? Math.floor((Date.now() - S.lastHelpTime) / 1000) : 999;
    const rlRemain0 = Math.max(0, 60 - rlElapsed0);
    if (rlRemain0 > 0) {
      clearTimers(); /* 清理上一次 mount 残留的定时器，避免重复倒计时 */
      let rlSec = rlRemain0;
      const rlIv = every(() => {
        rlSec--;
        if (rlSec <= 0) {
          clearTimers();
          render('help-types');
          toast('频率限制已解除，可以发起求助了', 'i-check');
        } else {
          const el = document.querySelector('#rlCount');
          if (el) el.textContent = rlSec;
          const btn = document.querySelector('#launchHelp');
          if (btn) btn.innerHTML = ic('i-video') + `请等待 ${rlSec}s 后发起`;
        }
      }, 1000);
    }

    /* 演示按钮：模拟刚发起过求助 */
    const demoRL = $('#demoRateLimit');
    if (demoRL) demoRL.onclick = () => {
      S.lastHelpTime = Date.now();
      toast('已模拟记录：刚刚发起过一次求助', 'i-clock');
      render('help-types');
    };

    $('#launchHelp').onclick = () => {
      /* 前置拦截：检查 1 分钟频率限制 */
      const elapsed = S.lastHelpTime > 0 ? Date.now() - S.lastHelpTime : 999999;
      if (elapsed < 60000) {
        const remaining = Math.ceil((60000 - elapsed) / 1000);
        showRateLimitDlg(remaining);
        return;
      }
      const m = openModal(`
        <div class="dialog">
          <div class="d-icon" style="background:var(--blue-l);color:var(--blue)">${ic('i-video')}</div>
          <h3>申请通话权限</h3>
          <div class="d-sub">视频守护需要使用您的<b>摄像头</b>与<b>麦克风</b>权限<br>通话将录音存档，用于服务质量监督</div>
          <div class="d-btns">
            <button class="btn btn-plain" data-deny>拒绝</button>
            <button class="btn btn-primary" data-allow>允许并求助</button>
          </div>
        </div>`);
      m.querySelector('[data-allow]').onclick = () => { closeModal(m); S.lastHelpTime = Date.now(); go('help-waiting'); };
      m.querySelector('[data-deny]').onclick = () => {
        closeModal(m);
        const m2 = openModal(`
          <div class="dialog">
            <div class="d-icon" style="background:var(--orange-l);color:var(--orange-d)">${ic('i-alert')}</div>
            <h3>权限未开启</h3>
            <div class="d-sub">没有摄像头/麦克风权限将无法进行视频守护<br>请前往系统设置开启权限</div>
            <div class="d-btns">
              <button class="btn btn-plain" data-bk>返回</button>
              <button class="btn btn-primary" data-go>去开启</button>
            </div>
          </div>`);
        m2.querySelector('[data-bk]').onclick = () => closeModal(m2);
        m2.querySelector('[data-go]').onclick = () => { closeModal(m2); toast('原型演示：已模拟开启权限', 'i-check'); };
      };
    };
  }
};

/* ============ 10. 等待匹配 ============ */
SCREENS['help-waiting'] = {
  html() {
    const type = FRAUD_TYPES.find(t => t.id === S.helpType);
    const C = 2 * Math.PI * 95;
    return `
    <div class="screen">
      <div class="wait-wrap">
        <h2 style="font-size:var(--fs-xl);margin-top:8px">正在为您匹配反诈专员<span class="wait-dots"><i></i><i></i><i></i></span></h2>
        <p style="color:var(--ink-3);font-size:var(--fs-sm);margin-top:8px">求助类型：${type ? type.name : '—'} · 按标签与信用权重智能派单</p>
        <div class="wait-ring">
          <svg width="210" height="210">
            <circle class="wr-bg" cx="105" cy="105" r="95" fill="none" stroke-width="10"/>
            <circle class="wr-fg" id="waitFg" cx="105" cy="105" r="95" fill="none" stroke-width="10"
              stroke-dasharray="${C}" stroke-dashoffset="0"/>
          </svg>
          <div class="wait-center"><b id="waitNum">60</b><span>秒</span></div>
        </div>
        <div class="wait-tips">
          <h4>${ic('i-alert')}等待期间请牢记</h4>
          <p id="waitTip">${WAIT_TIPS[0]}</p>
        </div>
        <button class="btn btn-plain" style="margin-top:20px;min-width:170px" id="cancelHelp">取消求助</button>
        <button style="margin-top:14px;font-size:var(--fs-xs);color:var(--ink-4);text-decoration:underline" id="demoTimeout">演示：模拟 60 秒超时场景</button>
      </div>
    </div>`;
  },
  mount() {
    const C = 2 * Math.PI * 95;
    let sec = 60, tipIdx = 0, connected = false;
    const tipIv = every(() => { tipIdx = (tipIdx + 1) % WAIT_TIPS.length; const el = $('#waitTip'); if (el) el.textContent = WAIT_TIPS[tipIdx]; }, 2600);
    const iv = every(() => {
      sec--;
      const num = $('#waitNum'); if (!num) return;
      num.textContent = sec;
      $('#waitFg').style.strokeDashoffset = C * (1 - sec / 60);
      if (sec <= 0) { clearTimers(); showTimeout(); }
    }, 1000);
    /* 演示加速：5 秒后模拟接通 */
    tick(() => { if (!connected) { connected = true; clearTimers(); toast('已接通守护者', 'i-check'); tick(() => go('call', { as: 'seeker' }), 500); } }, 5000);
    function showTimeout() {
      const m = openModal(`
        <div class="dialog">
          <div class="d-icon" style="background:var(--orange-l);color:var(--orange-d)">${ic('i-clock')}</div>
          <h3>连接超时</h3>
          <div class="d-sub">当前暂无专员响应<br>您可以继续等待或稍后再试</div>
          <div class="d-btns">
            <button class="btn btn-plain" data-cancel>取消求助</button>
            <button class="btn btn-primary" data-wait>继续等待</button>
          </div>
        </div>`);
      m.dataset.lock = '1';
      m.querySelector('[data-cancel]').onclick = () => { closeModal(m); back('home'); };
      m.querySelector('[data-wait]').onclick = () => { closeModal(m); render('help-waiting'); };
    }
    $('#demoTimeout').onclick = () => { clearTimers(); showTimeout(); };
    $('#cancelHelp').onclick = () => {
      const m = openModal(`
        <div class="dialog">
          <h3>确定要取消守护求助吗？</h3>
          <div class="d-sub">取消后将中止为您匹配反诈专员</div>
          <div class="d-btns">
            <button class="btn btn-plain" data-x>继续等待</button>
            <button class="btn btn-danger" data-ok>取消求助</button>
          </div>
        </div>`);
      m.querySelector('[data-x]').onclick = () => closeModal(m);
      m.querySelector('[data-ok]').onclick = () => { closeModal(m); clearTimers(); back('home'); };
    };
  }
};

/* ============ 11. 视频通话 ============ */
SCREENS.call = {
  dark: true,
  html(p) {
    const isGuard = p.as === 'guard';
    const type = FRAUD_TYPES.find(t => t.id === S.helpType) || FRAUD_TYPES[3];
    callTimerSec = 0;
    return `
    <div class="screen call-screen">
      <div class="call-remote">
        <div class="cr-bg"></div>
        <div class="call-status">
          <div class="cs-name">${isGuard ? '求助者 · ' + S.seeker.name : '守护者 · 李师傅'}（${type.name}）</div>
          <div class="cs-time" id="callTime">00:00</div>
        </div>
        <div class="call-avatar">
          <div class="ca-ring">${ic(isGuard ? 'i-user' : 'i-shield')}</div>
          <b>${isGuard ? S.seeker.name : '李师傅'}</b>
          <div class="ca-tags">
            ${isGuard
              ? '<span class="tag-mini">求助者</span><span class="tag-mini">已核实来电</span>'
              : '<span class="tag-mini">L4 反诈深耕者</span><span class="tag-mini">信用 S 级</span>'}
          </div>
        </div>
        <div class="call-self" id="selfView">${ic('i-user')}<span>我</span></div>
        <div class="call-caption" id="caption"></div>
      </div>
      <div class="call-record"><span class="rec-dot"></span>通话内容将被录音并转为文字存档，用于服务质量监督与合规审查</div>
      <div class="call-controls">
        <button class="cc-btn" id="muteBtn"><span class="cc-circle">${ic('i-mic')}</span>静音</button>
        <button class="cc-btn hangup" id="hangBtn"><span class="cc-circle">${ic('i-hangup')}</span>挂断</button>
        <button class="cc-btn" id="camBtn"><span class="cc-circle">${ic('i-cam-switch')}</span>翻转镜头</button>
      </div>
    </div>`;
  },
  mount(p) {
    const isGuard = p.as === 'guard';
    every(() => {
      callTimerSec++;
      const m = String(Math.floor(callTimerSec / 60)).padStart(2, '0');
      const s = String(callTimerSec % 60).padStart(2, '0');
      const el = $('#callTime'); if (el) el.textContent = `${m}:${s}`;
    }, 1000);
    /* 模拟守护者话术字幕 */
    let ci = 0;
    const cap = () => {
      if (ci >= CALL_CAPTIONS.length) return;
      const box = $('#caption'); if (!box) return;
      const d = document.createElement('div');
      d.className = 'caption-line';
      d.innerHTML = `<b>${isGuard ? '求助者' : '守护者'}：</b>${CALL_CAPTIONS[ci]}`;
      box.appendChild(d);
      while (box.children.length > 2) box.firstChild.remove();
      ci++;
      tick(cap, 3600);
    };
    tick(cap, 1400);
    let muted = false, flipped = false;
    $('#muteBtn').onclick = e => {
      muted = !muted;
      e.currentTarget.classList.toggle('on', muted);
      e.currentTarget.querySelector('.cc-circle').innerHTML = ic(muted ? 'i-mic-off' : 'i-mic');
      e.currentTarget.lastChild.textContent = muted ? '已静音' : '静音';
    };
    $('#camBtn').onclick = e => {
      flipped = !flipped;
      e.currentTarget.classList.toggle('on', flipped);
      $('#selfView').style.background = flipped ? 'linear-gradient(150deg,#3E5A34,#22301C)' : '';
      toast(flipped ? '已切换至后置摄像头' : '已切换至前置摄像头');
    };
    $('#hangBtn').onclick = () => {
      clearTimers();
      toast('通话结束', 'i-check');
      if (isGuard) tick(showGuardReward, 500);
      else tick(() => go('rate'), 500);
    };
  }
};

/* 守护者服务完成奖励弹窗 */
function showGuardReward() {
  const gain = Math.round(10 * 1.5);   // L3 加成 1.5x
  S.guard.points += gain;
  S.guard.credit = Math.min(100, S.guard.credit + 3);
  S.guard.helps += 1;
  const m = openModal(`
    <div class="dialog">
      <div class="reward-pop">
        <div class="reward-coin">${ic('i-coin')}</div>
        <h3>本次守护完成</h3>
        <div class="reward-num">+${gain} 积分</div>
        <div class="reward-lines">
          基础 10 分 × L3 加成 1.5x<br>
          信用分 <b>+3</b>（当前 ${S.guard.credit} 分） · 累计帮助 <b>${S.guard.helps}</b> 次
        </div>
      </div>
      <div class="d-btns" style="margin-top:20px"><button class="btn btn-green" data-ok>太好了</button></div>
    </div>`);
  m.querySelector('[data-ok]').onclick = () => { closeModal(m); resetTo('guard'); };
}

/* ============ 12. 服务评价 ============ */
SCREENS.rate = {
  html() {
    return `
    <div class="screen">
      ${navbar('服务评价')}
      <div class="rate-hero">
        <div class="rh-avatar">${ic('i-shield')}</div>
        <h2 style="font-size:var(--fs-lg)">守护者 · 4级反诈深耕者</h2>
        <p style="color:var(--ink-3);font-size:var(--fs-sm);margin-top:5px">本次守护通话 06:23 · 感谢您的信任</p>
      </div>
      <div class="stars" id="starRow" style="margin-top:20px">
        ${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}">${ic('i-star')}</button>`).join('')}
      </div>
      <div class="rate-word" id="rateWord">请点击星星评分</div>
      <div class="rate-tags" id="rateTags"></div>
      <div class="form-field" style="margin-top:16px">
        <textarea class="input" id="rateText" placeholder="其他意见或建议（选填）"></textarea>
      </div>
      <div class="rate-summary">评价提交后，守护者将实时获得信用分与积分激励：<br><b>4-5 星</b>：+5 积分 / 信用 +2~5 分；<b>1-2 星</b>：信用 -3~5 分</div>
      <div class="bottom-cta"><button class="btn btn-primary btn-lg btn-block" id="rateSubmit" disabled>提交评价</button></div>
    </div>`;
  },
  mount() {
    bindBack(app);
    const POS = ['响应及时', '解答专业', '态度友好', '操作指引清晰', '建议实用有效', '成功解决'];
    const NEG = ['响应慢', '解答不专业', '态度敷衍', '操作指引不清晰', '建议无效', '未能识别诈骗类型'];
    const WORDS = ['', '非常不满意', '不满意', '一般', '满意', '非常满意'];
    let star = 0; const picked = new Set();
    app.querySelectorAll('[data-star]').forEach(b => b.onclick = () => {
      star = +b.dataset.star;
      app.querySelectorAll('[data-star]').forEach(x => x.querySelector('.ic').classList.toggle('on', +x.dataset.star <= star));
      $('#rateWord').textContent = WORDS[star];
      $('#rateSubmit').disabled = false;
      picked.clear();
      $('#rateTags').innerHTML = (star >= 4 ? POS : NEG).map(t => `<button class="chip" data-rt="${t}">${t}</button>`).join('');
      app.querySelectorAll('[data-rt]').forEach(c => c.onclick = () => {
        c.classList.toggle('on');
        picked.has(c.dataset.rt) ? picked.delete(c.dataset.rt) : picked.add(c.dataset.rt);
      });
    });
    $('#rateSubmit').onclick = () => {
      S.records.unshift({
        id: 'r' + Date.now(), type: (FRAUD_TYPES.find(t => t.id === S.helpType) || {}).name || '其他诈骗类型',
        phone: '138****6688', lv: 4, dur: '6分23秒', time: '刚刚', star, status: 'done',
        tags: [...picked], feedback: $('#rateText').value.trim(),
      });
      toast('评价提交成功，感谢您的反馈', 'i-check');
      tick(() => resetTo('home'), 700);
    };
  }
};

/* ============ 13. 守护者工作台 ============ */
SCREENS.guard = {
  tab: 'guard',
  html() {
    const g = S.guard;
    const lv = LEVELS[g.level - 1];
    const grade = CREDIT_GRADES.find(c => g.credit >= c.min && g.credit <= c.max);
    return `
    <div class="screen has-tab">
      <div class="guard-hero ${g.online ? '' : 'off'}">
        <div class="hh-top">
          <div><div class="hh-hello">${g.online ? '守护在线中' : '当前休息中'}</div><div class="hh-name">${g.name}</div></div>
          <button class="hh-bell" id="gBell">${ic('i-msg')}</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <span class="tag-mini" style="background:rgba(255,255,255,.2);color:#fff">L${g.level} ${lv.name}</span>
          <span class="tag-mini" style="background:rgba(255,255,255,.2);color:#fff">信用 ${grade.g} · ${g.credit}分</span>
        </div>
      </div>
      <div class="online-card">
        <div class="online-status ${g.online ? 'on' : ''}"><span class="os-dot"></span>${g.online ? '正在接收派单' : '已暂停接单'}</div>
        <div class="radar-wrap ${g.online ? 'on' : ''}">
          <div class="rw-ring"></div><div class="rw-ring"></div><div class="rw-ring"></div>
          <div class="radar-core">${ic('i-radar')}</div>
        </div>
        <p style="font-size:var(--fs-sm);color:var(--ink-3);line-height:1.7">${g.online ? '保持在线，系统按您的能力标签派单<br>连续在线满 2 小时 +20 积分' : '开启在线状态后，即可接收求助派单'}</p>
        <button class="btn ${g.online ? 'btn-plain' : 'btn-green'} btn-lg btn-block" style="margin-top:14px" id="onlineBtn">
          ${g.online ? '暂停接单' : '开启在线守护'}
        </button>
        ${g.online ? '<button style="margin-top:10px;font-size:var(--fs-xs);color:var(--ink-4);text-decoration:underline" id="demoOrder">演示：立即模拟一笔派单</button>' : ''}
      </div>
      <div class="stat-row">
        <div class="stat-cell"><b style="color:var(--blue)">3</b><span>今日接单</span></div>
        <div class="stat-cell"><b style="color:var(--green)">${g.helps}</b><span>累计帮助</span></div>
        <div class="stat-cell"><b style="color:var(--gold)">${g.score}</b><span>平均评分</span></div>
      </div>
      <div class="mini-cards">
        <button class="mini-card" data-g="level"><div class="mc-top" style="color:var(--gold)">${ic('i-medal')}我的等级</div><b>L${g.level} ${lv.name}</b><div class="mc-extra">积分加成 ${lv.ratio}，升级进度 ${Math.min(100, Math.round(g.helps / LEVELS[g.level].helps * 100))}%</div></button>
        <button class="mini-card" data-g="credit"><div class="mc-top" style="color:var(--blue)">${ic('i-credit')}信用中心</div><b>${g.credit} 分 · ${grade.g}级</b><div class="mc-extra">${grade.name} · 派单权重 ${grade.weight}</div></button>
        <button class="mini-card" data-g="tags-manage"><div class="mc-top" style="color:var(--green)">${ic('i-tag')}能力标签</div><b>${g.tags.length} 个标签</b><div class="mc-extra">标签越多，接单场景越广</div></button>
        <button class="mini-card" data-g="records"><div class="mc-top" style="color:var(--orange-d)">${ic('i-doc')}守护记录</div><b>${g.helps} 次服务</b><div class="mc-extra">查看全部服务与评价</div></button>
      </div>
      <div style="height:22px"></div>
    </div>`;
  },
  mount() {
    $('#gBell').onclick = () => resetTo('messages');
    app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => go(b.dataset.g));
    $('#onlineBtn').onclick = () => {
      S.guard.online = !S.guard.online;
      if (S.guard.online) {
        toast('已上线，正在为您匹配求助单', 'i-check');
        render('guard');
        /* 在线 8 秒后自动来单（演示） */
        tick(() => { if (S.guard.online) showIncomingOrder(); }, 8000);
      } else { render('guard'); toast('已暂停接单'); }
    };
    const demo = $('#demoOrder');
    if (demo) demo.onclick = showIncomingOrder;
  }
};

/* 派单弹窗 */
function showIncomingOrder() {
  const type = FRAUD_TYPES[Math.floor(Math.random() * 3)];
  let sec = 30;
  const m = openModal(`
    <div class="order-pop">
      <div class="op-head">${ic('i-alert')}<b>紧急求助单</b><span class="op-count" id="opCount">30s</span></div>
      <div class="op-body">
        <div class="op-row"><span class="op-label">诈骗类型</span><b>${type.name}</b><span class="tag-mini tag-red" style="margin-left:auto">高发</span></div>
        <div class="op-row"><span class="op-label">求助者</span><b>王女士 · 62 岁</b></div>
        <div class="op-row"><span class="op-label">情况摘要</span><span style="line-height:1.6">接到"快递理赔"电话，对方正引导下载软件，本人不确定真假</span></div>
        <div class="op-row"><span class="op-label">标签匹配</span><b style="color:var(--green)">100% 匹配您的能力标签</b></div>
        <div class="d-btns" style="margin-top:14px">
          <button class="btn btn-plain" data-rej>暂不方便</button>
          <button class="btn btn-green" data-acc>${ic('i-video')}立即接听</button>
        </div>
      </div>
    </div>`);
  m.dataset.lock = '1';
  const iv = every(() => {
    sec--;
    const el = m.querySelector('#opCount');
    if (el) el.textContent = sec + 's';
    if (sec <= 0) { clearTimers(); closeModal(m); toast('30 秒未响应，订单已顺延'); }
  }, 1000);
  m.querySelector('[data-rej]').onclick = () => { clearTimers(); closeModal(m); toast('已婉拒，系统将顺延派单'); };
  m.querySelector('[data-acc]').onclick = () => {
    clearTimers(); closeModal(m);
    S.helpType = FRAUD_TYPES.find(t => t.name === '冒充客服退款类').id;
    go('call', { as: 'guard' });
  };
}

/* ============ 14. 等级体系 ============ */
SCREENS.level = {
  html() {
    const g = S.guard, cur = LEVELS[g.level - 1], next = LEVELS[g.level];
    const hp = next ? Math.min(100, Math.round(g.helps / next.helps * 100)) : 100;
    const sp = next ? Math.min(100, Math.round(g.score / next.score * 100)) : 100;
    return `
    <div class="screen">
      ${navbar('我的等级', { cls: 'transparent on-dark' })}
      <div class="level-hero" style="padding-top:56px">
        <div class="level-cur">
          <div class="level-badge">${ic('i-medal')}</div>
          <div><h2>L${g.level} · ${cur.name}</h2><p>积分加成系数 ${cur.ratio} · 等级永久保留</p></div>
        </div>
        ${next ? `
        <div class="level-progress">
          <div style="font-size:var(--fs-sm);opacity:.85">距 L${next.lv} ${next.name} 还需同时满足：</div>
          <div class="lp-row"><div class="lp-label">累计帮助次数<b>${g.helps} / ${next.helps}</b></div><div class="pbar"><i style="width:${hp}%"></i></div></div>
          <div class="lp-row"><div class="lp-label">平均评分<b>${g.score} / ${next.score}</b></div><div class="pbar"><i style="width:${sp}%"></i></div></div>
        </div>` : '<p style="margin-top:18px;font-size:var(--fs-sm);opacity:.85">您已达到最高等级，感谢您的守护！</p>'}
      </div>
      <div class="sec-title">守护者成长体系（5 级）</div>
      ${LEVELS.map(l => `
        <div class="level-item ${l.lv === g.level ? 'cur' : ''} ${l.lv <= g.level ? 'reached' : ''}">
          <div class="lv-no">L${l.lv}</div>
          <div style="flex:1">
            <h3>${l.name}
              ${l.lv === g.level ? '<span class="tag-mini tag-gold">当前等级</span>' : ''}
              ${l.lv < g.level ? '<span class="tag-mini tag-green">已达成</span>' : ''}
            </h3>
            <p>${l.need}</p>
            <p style="color:var(--gold);font-weight:600">积分加成 ${l.ratio}</p>
          </div>
        </div>`).join('')}
      <div class="proto-note">升级需同时满足服务次数与平均评分双指标，系统每日凌晨统计自动升级；等级权益 V1 仅包含积分加成系数（PRD 5.3）。</div>
      <div style="height:20px"></div>
    </div>`;
  },
  mount() { bindBack(app); }
};

/* ============ 15. 信用中心 ============ */
SCREENS.credit = {
  html() {
    const g = S.guard;
    const grade = CREDIT_GRADES.find(c => g.credit >= c.min && g.credit <= c.max);
    const C = 2 * Math.PI * 80;
    const off = C * (1 - g.credit / 100);
    const qualityScore = 54; /* 质量分 60 满分 */
    const behaviorScore = 28; /* 行为分 40 满分 */
    return `
    <div class="screen">
      ${navbar('信用中心', { cls: 'transparent on-dark' })}
      <div class="credit-hero" style="padding-top:56px">
        <div class="credit-score-wrap">
          <svg width="180" height="180">
            <defs><linearGradient id="creditGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#7FB5EE"/><stop offset="1" stop-color="#F2C14E"/>
            </linearGradient></defs>
            <circle cx="90" cy="90" r="80" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="12"/>
            <circle class="cs-fg" cx="90" cy="90" r="80" fill="none" stroke-width="12"
              stroke-dasharray="${C}" stroke-dashoffset="${off}"/>
          </svg>
          <div class="credit-center"><b>${g.credit}</b><span>满分 100 · 近90天行为</span></div>
        </div>
        <div class="credit-grade"><span class="cg-letter">${grade.g}</span>${grade.name} · 派单权重 ${grade.weight}</div>
      </div>
      <div class="credit-card credit-dims">
        <div style="font-weight:700;margin-bottom:14px">信用分构成（双维模型）</div>
        <div class="cd-row">
          <div class="cd-label">服务质量（满分 60）<b>${qualityScore} 分</b></div>
          <div class="pbar"><i style="width:${qualityScore / 60 * 100}%"></i></div>
        </div>
        <div class="cd-row">
          <div class="cd-label">行为合规（满分 40）<b>${behaviorScore} 分</b></div>
          <div class="pbar green"><i style="width:${behaviorScore / 40 * 100}%"></i></div>
        </div>
      </div>
      <div class="sec-title">等级与派单权益</div>
      <div style="margin:0 16px" class="card">
        ${CREDIT_GRADES.map(c => `
          <div class="list-item" style="padding:12px 16px">
            <span class="cg-letter" style="width:30px;height:30px;border-radius:50%;background:${c.color};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;flex:none">${c.g}</span>
            <div class="li-body">
              <div class="li-title" style="font-size:var(--fs-md)">${c.name}<span style="color:var(--ink-4);font-weight:400;font-size:var(--fs-sm)">　${c.min}-${c.max} 分 · ${c.weight}</span></div>
              <div class="li-sub">${c.benefit}</div>
            </div>
          </div>`).join('')}
      </div>
      <div class="sec-title">近期信用变动</div>
      <div style="margin:0 16px 20px" class="card">
        ${CREDIT_RECORDS.map(r => `
          <button class="credit-record" data-credit-record="${r.id}" style="width:100%">
            <span class="cr-sign ${r.sign === '+' ? 'cr-plus' : 'cr-minus'}">${r.sign}${r.num}</span>
            <div style="flex:1;text-align:left"><div style="font-size:var(--fs-md);font-weight:600">${r.reason}</div><div style="font-size:var(--fs-xs);color:var(--ink-4);margin-top:3px">${r.time}</div></div>
            ${r.appealable && !r.appealed ? '<span class="tag-mini tag-red">可申诉</span>' : ''}
            ${ic('i-right', 'credit-arrow')}
          </button>`).join('')}
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    /* 点击信用变动记录进入详情 */
    app.querySelectorAll('[data-credit-record]').forEach(b => b.onclick = () => go('credit-record-detail', { id: b.dataset.creditRecord }));
  }
};

/* ============ 15b. 信用变动详情 ============ */
SCREENS['credit-record-detail'] = {
  html(p) {
    const r = CREDIT_RECORDS.find(x => x.id === p.id) || {};
    const isDeduct = r.sign === '-';
    const h = r.guard || {};
    return `
    <div class="screen">
      ${navbar('信用变动详情')}

      <div style="text-align:center;padding:20px 20px 8px">
        <div class="cr-sign-big" style="color:${isDeduct ? 'var(--red)' : 'var(--green)'}">${r.sign}${r.num}</div>
        <div style="font-size:var(--fs-md);font-weight:600;margin-top:6px">${r.reason}</div>
        <div style="font-size:var(--fs-sm);color:var(--ink-4);margin-top:4px">${r.time}</div>
      </div>

      <div class="sec-title">守护信息</div>
      <div style="margin:0 16px" class="card">
        <div class="list-item" style="padding:12px 16px">
          <div class="li-icon" style="background:var(--blue-l);color:var(--blue)">${ic('i-shield')}</div>
          <div class="li-body"><div class="li-title">诈骗类型</div><div class="li-sub">${h.type || '-'}</div></div>
        </div>
        <div class="list-item" style="padding:12px 16px">
          <div class="li-icon" style="background:var(--green-l);color:var(--green)">${ic('i-user')}</div>
          <div class="li-body"><div class="li-title">求助者</div><div class="li-sub">${h.requester || '-'}</div></div>
        </div>
        <div class="list-item" style="padding:12px 16px">
          <div class="li-icon" style="background:var(--orange-l);color:var(--orange-d)">${ic('i-video')}</div>
          <div class="li-body"><div class="li-title">通话时长</div><div class="li-sub">${h.duration || '-'}</div></div>
        </div>
        <div class="list-item" style="padding:12px 16px">
          <div class="li-icon" style="background:var(--gold-l);color:var(--gold)">${ic('i-star')}</div>
          <div class="li-body"><div class="li-title">服务评分</div><div class="li-sub">${h.star ? h.star + ' 星' : '未评价'}</div></div>
        </div>
      </div>

      <div class="sec-title">变动说明</div>
      <div style="margin:0 16px 14px;padding:14px 16px" class="card">
        <div style="font-size:var(--fs-sm);color:var(--ink-2);line-height:1.8">${r.detail || '-'}</div>
      </div>

      ${isDeduct && r.appealable ? `
      <div class="bottom-cta" style="padding-bottom:20px">
        <button class="btn btn-primary btn-lg btn-block" id="appealBtn">${ic('i-edit')} 申请信用扣分申诉</button>
      </div>` : ''}
    </div>`;
  },
  mount(p) {
    bindBack(app);
    const r = CREDIT_RECORDS.find(x => x.id === p.id) || {};
    if (r.sign === '-' && r.appealable) {
      $('#appealBtn').onclick = () => {
        const m = openModal(`
          <div class="sheet-panel">
            <div class="sheet-handle"></div>
            <h3 style="margin-bottom:6px">信用扣分申诉</h3>
            <p style="font-size:var(--fs-sm);color:var(--ink-3);margin-bottom:16px">扣分原因：${r.reason}<br>扣分时间：${r.time}<br>扣分分值：-${r.num}</p>
            <div class="form-field" style="margin:0 0 12px"><label>申诉理由</label><textarea class="input" id="apReason" placeholder="请描述您的申诉理由，例如：当时正在处理紧急工单、系统网络异常等"></textarea></div>
            <div class="form-field" style="margin:0 0 18px"><label>证据截图（选填）</label><button class="btn btn-ghost btn-block" data-up>${ic('i-plus')}上传截图/凭证</button></div>
            <button class="btn btn-primary btn-lg btn-block" data-sub>提交申诉</button>
          </div>`, true);
        m.querySelector('[data-up]').onclick = () => toast('原型演示：图片上传占位');
        m.querySelector('[data-sub]').onclick = () => {
          if (!m.querySelector('#apReason').value.trim()) return toast('请填写申诉理由', 'i-alert');
          r.appealed = true;
          closeModal(m);
          toast('申诉已提交，3 个工作日内反馈结果', 'i-check');
          tick(() => back(), 800);
        };
      };
    }
  }
};

/* ============ 16. 能力标签管理 ============ */
SCREENS['tags-manage'] = {
  html() {
    const g = S.guard;
    const rest = FRAUD_TYPES.filter(t => !g.tags.includes(t.name));
    return `
    <div class="screen">
      ${navbar('能力标签')}
      <div class="sec-title">已持有标签（${g.tags.length}）</div>
      <div style="margin:0 16px" class="card">
        ${g.tags.map(name => {
          const t = FRAUD_TYPES.find(x => x.name === name);
          return `<div class="list-item">
            <div class="li-icon" style="background:${t.color}1A;color:${t.color}">${ic(t.icon)}</div>
            <div class="li-body"><div class="li-title">${name}</div><div class="li-sub">测评已通过 · 永久有效</div></div>
            <span class="tag-mini tag-green">派单中</span>
          </div>`;
        }).join('')}
      </div>
      <div class="sec-title">添加新标签</div>
      <p style="margin:0 20px 10px;font-size:var(--fs-sm);color:var(--ink-3);line-height:1.7">每添加 1 个标签需通过 5 道题测评（正确率 ≥80%），标签越多可匹配的求助场景越广。</p>
      <div style="margin:0 16px 20px" class="card">
        ${rest.map(t => `
          <div class="list-item">
            <div class="li-icon" style="background:${t.color}1A;color:${t.color}">${ic(t.icon)}</div>
            <div class="li-body"><div class="li-title">${t.name}</div><div class="li-sub">${t.desc}</div></div>
            <button class="btn btn-sm btn-ghost" data-add="${t.name}">去测评</button>
          </div>`).join('') || '<div class="empty"><p>已持有全部标签</p></div>'}
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    app.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
      S.pendingTags = [b.dataset.add];
      confirmDlg('开始标签测评', `将对「${b.dataset.add}」进行 5 道题测评<br>正确率达到 80% 即可生效`, '开始测评', () => startQuiz('addTag'));
    });
  }
};

/* ============ 17. 积分商城 ============ */
SCREENS.mall = {
  tab: 'mall',
  html() {
    const pts = S.role === 'guardian' ? S.guard.points : S.seeker.points;
    const cats = ['全部', '实物', '虚拟', '热门'];
    const list = PRODUCTS.filter(p =>
      S.mallCat === '全部' ? true : S.mallCat === '热门' ? p.hot : p.cat === S.mallCat);
    return `
    <div class="screen has-tab">
      <div class="mall-hero">
        <div class="mall-points">
          <div class="mp-icon">${ic('i-coin')}</div>
          <div><span>我的积分</span><br><b>${fmt(pts)}</b></div>
          <button class="btn btn-sm" id="toOrders">兑换订单</button>
        </div>
      </div>
      <div class="mall-cats">
        ${cats.map(c => `<button class="chip ${S.mallCat === c ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}
      </div>
      <div class="prod-grid">
        ${list.map(p => `
          <button class="prod-card" data-prod="${p.id}">
            <div class="prod-img" style="background:linear-gradient(145deg,${p.color}EE,${p.color}AA)">
              ${ic(p.icon)}
              <span class="p-stock">${p.stock > 0 ? '库存 ' + p.stock : '已售罄'}</span>
              ${p.hot ? '<span class="p-hot-tag">HOT</span>' : ''}
            </div>
            <div class="prod-body">
              <div class="prod-name">${p.name}</div>
              <div class="prod-price">${ic('i-coin')}${fmt(p.points)}</div>
            </div>
          </button>`).join('')}
      </div>
    </div>`;
  },
  mount() {
    $('#toOrders').onclick = () => go('orders');
    app.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { S.mallCat = b.dataset.cat; render('mall'); });
    app.querySelectorAll('[data-prod]').forEach(b => b.onclick = () => { curProduct = PRODUCTS.find(p => p.id === b.dataset.prod); go('product'); });
  }
};

/* ============ 18. 商品详情 & 兑换 ============ */
SCREENS.product = {
  html() {
    const p = curProduct;
    const pts = S.role === 'guardian' ? S.guard.points : S.seeker.points;
    const enough = pts >= p.points;
    return `
    <div class="screen">
      ${navbar('', { cls: 'transparent on-dark' })}
      <div class="detail-gallery" style="background:linear-gradient(145deg,${p.color}DD,${p.color}99)">
        ${ic(p.icon)}
        ${p.hot ? '<span class="detail-hot-tag">热门推荐</span>' : ''}
      </div>
      <div class="detail-body">
        <div style="display:flex;gap:8px;align-items:center">
          <h2 style="font-size:var(--fs-xl);flex:1">${p.name}</h2>
          <span class="tag-mini ${p.cat === '实物' ? 'tag-blue' : 'tag-green'}">${p.cat}商品</span>
        </div>
        <div class="detail-price">
          ${ic('i-coin')}${fmt(p.points)}
          <span class="dp-enough" style="color:${enough ? 'var(--green)' : 'var(--red)'}">
            我的积分 ${fmt(pts)}${enough ? ' · 充足' : ` · 还差 ${fmt(p.points - pts)}`}
          </span>
        </div>
        <div style="font-size:var(--fs-sm);color:var(--ink-3)">库存 ${p.stock} 件 · 每人每月限兑 2 件</div>
      </div>
      <div class="detail-tabs">
        <button class="dtab on" data-tab="desc">商品介绍</button>
        <button class="dtab" data-tab="rule">兑换规则</button>
      </div>
      <div class="detail-content" id="detailContent">
        <div class="detail-rich">
          ${p.htmlDesc || `<p>${p.desc}</p>`}
        </div>
      </div>
      <div class="bottom-cta">
        ${p.stock <= 0
          ? '<button class="btn btn-plain btn-lg btn-block" disabled>已售罄</button>'
          : `<button class="btn btn-primary btn-lg btn-block" id="buyBtn">${ic('i-gift')}立即兑换</button>`}
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    const p = curProduct;
    /* Tab switching */
    app.querySelectorAll('.dtab').forEach(t => t.onclick = () => {
      app.querySelectorAll('.dtab').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      const content = $('#detailContent');
      if (t.dataset.tab === 'desc') {
        content.innerHTML = `<div class="detail-rich">${p.htmlDesc || `<p>${p.desc}</p>`}</div>`;
      } else {
        content.innerHTML = `<div class="detail-rich">
          <h3>兑换规则</h3>
          <ul>
            <li>兑换后积分即时扣除，订单取消积分退回</li>
            <li>实物商品：3 个工作日内发货，包邮到家</li>
            <li>虚拟商品：兑换码通过站内信即时发放</li>
            <li>每人每月限兑 2 件同款商品</li>
            <li>所有商品不支持 7 天无理由退换</li>
          </ul>
          <h3>配送说明</h3>
          <p>实物商品将通过顺丰速运发货，全国大部分地区 3-5 个工作日送达。虚拟商品兑换码有效期为 30 天，请及时使用。</p>
        </div>`;
      }
    });
    const btn = $('#buyBtn');
    if (!btn) return;
    btn.onclick = () => {
      const pts = S.role === 'guardian' ? S.guard.points : S.seeker.points;
      if (pts < p.points) return toast(`积分不足，还差 ${fmt(p.points - pts)} 积分`, 'i-alert');
      if (p.cat === '实物') showAddrSheet(p);
      else confirmExchange(p, null);
    };
  }
};

function showAddrSheet(p) {
  const def = S.addr.find(a => a.def) || S.addr[0];
  if (!def) { toast('请先添加收货地址', 'i-alert'); return go('address'); }
  let selId = def.id;
  const m = openModal(`
    <div class="sheet-panel">
      <div class="sheet-handle"></div>
      <h3 style="margin-bottom:14px">选择收货地址</h3>
      <div id="addrPick">
        ${S.addr.map(a => `
          <button class="type-card ${a.id === selId ? 'on' : ''}" style="margin:0 0 10px;width:100%" data-addr="${a.id}">
            <div class="tc-icon" style="background:var(--blue-l);color:var(--blue);width:44px;height:44px;border-radius:12px">${ic('i-loc')}</div>
            <div style="flex:1;min-width:0"><h3>${a.name}　<span style="font-weight:400;color:var(--ink-3);font-size:var(--fs-sm)">${a.phone}</span></h3>
            <p>${a.region} ${a.detail}</p></div>
            <span class="tc-check">${ic('i-check')}</span>
          </button>`).join('')}
      </div>
      <button class="btn btn-plain btn-block" style="margin-bottom:12px" data-newaddr>${ic('i-plus')}新增收货地址</button>
      <button class="btn btn-primary btn-lg btn-block" data-confirm>确认兑换（${fmt(p.points)} 积分）</button>
    </div>`, true);
  m.querySelectorAll('[data-addr]').forEach(b => b.onclick = () => {
    selId = b.dataset.addr;
    m.querySelectorAll('[data-addr]').forEach(x => x.classList.toggle('on', x.dataset.addr === selId));
  });
  m.querySelector('[data-newaddr]').onclick = () => { closeModal(m); go('address'); };
  m.querySelector('[data-confirm]').onclick = () => {
    const addr = S.addr.find(a => a.id === selId);
    closeModal(m);
    confirmExchange(p, addr);
  };
}

function confirmExchange(p, addr) {
  const m = openModal(`
    <div class="dialog">
      <div class="d-icon" style="background:var(--gold-l);color:var(--gold)">${ic('i-gift')}</div>
      <h3>确认兑换</h3>
      <div class="d-sub" style="text-align:left">
        商品：<b>${p.name}</b><br>
        消耗：<b style="color:var(--gold)">${fmt(p.points)} 积分</b><br>
        ${addr ? `收货：${addr.name} ${addr.region}${addr.detail}` : '发放：兑换码将通过站内信发送'}
      </div>
      <div class="d-btns">
        <button class="btn btn-plain" data-x>再想想</button>
        <button class="btn btn-primary" data-ok>确认兑换</button>
      </div>
    </div>`);
  m.querySelector('[data-x]').onclick = () => closeModal(m);
  m.querySelector('[data-ok]').onclick = () => {
    closeModal(m);
    if (S.role === 'guardian') S.guard.points -= p.points; else S.seeker.points -= p.points;
    p.stock -= 1;
    S.orders.unshift({
      id: 'o' + Date.now(), no: 'SO' + Date.now(), name: p.name, icon: p.icon, color: p.color,
      points: p.points, status: '待发货', time: '刚刚',
    });
    const ok = openModal(`
      <div class="dialog">
        <div class="result-badge" style="width:80px;height:80px;background:linear-gradient(135deg,#12997A,#0F6E56)">${ic('i-check')}</div>
        <h3>兑换成功</h3>
        <div class="d-sub">${p.cat === '实物' ? '商家将在 3 个工作日内发货' : `兑换码：<b style="letter-spacing:2px">FK${String(Date.now()).slice(-8)}</b><br>已同步发送至站内信`}</div>
        <div class="d-btns">
          <button class="btn btn-plain" data-home>继续逛逛</button>
          <button class="btn btn-primary" data-order>查看订单</button>
        </div>
      </div>`);
    ok.querySelector('[data-home]').onclick = () => { closeModal(ok); resetTo('mall'); };
    ok.querySelector('[data-order]').onclick = () => { closeModal(ok); S.orderTab = '全部'; go('orders'); };
  };
}

/* ============ 19. 兑换订单 ============ */
SCREENS.orders = {
  html() {
    const tabs = ['全部', '待发货', '已发货', '已完成', '已取消'];
    const list = S.orders.filter(o => S.orderTab === '全部' || o.status === S.orderTab);
    const colorOf = s => ({ '待发货': 'tag-orange', '已发货': 'tag-blue', '已完成': 'tag-green', '已取消': 'tag-gray' }[s]);
    return `
    <div class="screen">
      ${navbar('兑换订单')}
      <div class="order-tabs">
        ${tabs.map(t => `<button class="${S.orderTab === t ? 'on' : ''}" data-ot="${t}">${t}</button>`).join('')}
      </div>
      <div style="flex:1;padding-bottom:20px">
        ${list.length ? list.map(o => `
          <div class="order-card">
            <div class="oc-head">订单号 ${o.no}<b class="tag-mini ${colorOf(o.status)}">${o.status}</b></div>
            <div class="oc-body">
              <div class="oc-img" style="background:${o.color}">${ic(o.icon)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:var(--fs-md)">${o.name}</div>
                <div style="font-size:var(--fs-xs);color:var(--ink-4);margin-top:5px">下单时间 ${o.time}</div>
                <div style="color:var(--gold);font-weight:700;margin-top:6px;font-size:var(--fs-md)">${fmt(o.points)} 积分</div>
              </div>
            </div>
            <div class="oc-foot">
              ${o.status === '已发货' ? `<button class="btn btn-sm btn-ghost" data-logi="${o.id}">${ic('i-truck')}查看物流</button><button class="btn btn-sm btn-primary" data-recv="${o.id}">确认收货</button>` : ''}
              ${o.status === '待发货' ? `<button class="btn btn-sm btn-plain" data-cancel="${o.id}">取消订单</button>` : ''}
            </div>
          </div>`).join('')
        : `<div class="empty">${ic('i-doc')}<p>暂无相关订单</p></div>`}
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    app.querySelectorAll('[data-ot]').forEach(b => b.onclick = () => { S.orderTab = b.dataset.ot; render('orders'); });
    app.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => {
      const o = S.orders.find(x => x.id === b.dataset.cancel);
      confirmDlg('取消订单', '取消后积分将即时退回您的账户', '确认取消', () => {
        o.status = '已取消';
        if (S.role === 'guardian') S.guard.points += o.points; else S.seeker.points += o.points;
        toast('订单已取消，积分已退回', 'i-check');
        render('orders');
      }, true);
    });
    app.querySelectorAll('[data-recv]').forEach(b => b.onclick = () => {
      const o = S.orders.find(x => x.id === b.dataset.recv);
      confirmDlg('确认收货', '请确认已收到商品', '确认收货', () => {
        o.status = '已完成';
        toast('已确认收货，交易完成', 'i-check');
        render('orders');
      });
    });
    app.querySelectorAll('[data-logi]').forEach(b => b.onclick = () => {
      const o = S.orders.find(x => x.id === b.dataset.logi);
      const m = openModal(`
        <div class="sheet-panel">
          <div class="sheet-handle"></div>
          <h3 style="margin-bottom:6px">物流追踪</h3>
          <p style="font-size:var(--fs-sm);color:var(--ink-3);margin-bottom:18px">顺丰速运 SF1386688992 · ${o.name}</p>
          ${(o.logistics || []).map((l, i) => `
            <div class="logi-step ${i === 0 ? 'cur' : ''}">
              <div class="ls-line"><span class="ls-dot"></span><span class="ls-bar"></span></div>
              <div class="ls-body">${l.d}<br><time style="font-size:11px;color:var(--ink-4)">${l.t}</time></div>
            </div>`).join('')}
          <button class="btn btn-plain btn-block" style="margin-top:8px" data-close>关闭</button>
        </div>`, true);
      m.querySelector('[data-close]').onclick = () => closeModal(m);
    });
  }
};

/* ============ 20. 收货地址 ============ */
SCREENS.address = {
  html() {
    return `
    <div class="screen">
      ${navbar('收货地址', { right: '<span style="width:38px"></span>' })}
      <div style="flex:1;padding-bottom:14px">
        ${S.addr.map(a => `
          <div class="addr-card">
            <div class="ac-top">
              <b>${esc(a.name)}</b><span>${a.phone}</span>
              ${a.def ? '<span class="tag-mini tag-orange" style="margin-left:auto">默认</span>' : ''}
            </div>
            <p>${a.region} ${esc(a.detail)}</p>
            <div class="ac-acts">
              <button class="set-default ${a.def ? 'on' : ''}" data-def="${a.id}">${ic('i-check')}${a.def ? '默认地址' : '设为默认'}</button>
              <button data-edit="${a.id}" style="margin-left:auto">${ic('i-edit')}编辑</button>
              <button data-del="${a.id}">${ic('i-del')}删除</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="bottom-cta"><button class="btn btn-primary btn-lg btn-block" id="addAddr">${ic('i-plus')}新增收货地址</button></div>
    </div>`;
  },
  mount() {
    bindBack(app);
    $('#addAddr').onclick = () => addrForm(null);
    app.querySelectorAll('[data-def]').forEach(b => b.onclick = () => {
      S.addr.forEach(a => a.def = a.id === b.dataset.def);
      render('address');
    });
    app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      confirmDlg('删除地址', '删除后不可恢复，确定删除该地址吗？', '删除', () => {
        S.addr = S.addr.filter(a => a.id !== b.dataset.del);
        if (S.addr.length && !S.addr.some(a => a.def)) S.addr[0].def = true;
        toast('地址已删除', 'i-check');
        render('address');
      }, true);
    });
    app.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => addrForm(S.addr.find(a => a.id === b.dataset.edit)));
  }
};

function addrForm(a) {
  const m = openModal(`
    <div class="sheet-panel">
      <div class="sheet-handle"></div>
      <h3 style="margin-bottom:16px">${a ? '编辑地址' : '新增收货地址'}</h3>
      <div class="form-field" style="margin:0 0 12px"><label>收货人</label><input class="input" id="afName" value="${a ? esc(a.name) : ''}" placeholder="请输入姓名"></div>
      <div class="form-field" style="margin:0 0 12px"><label>手机号</label><input class="input" id="afPhone" maxlength="13" value="${a ? a.phone : ''}" placeholder="请输入手机号"></div>
      <div class="form-field" style="margin:0 0 12px"><label>所在地区</label><input class="input" id="afRegion" value="${a ? a.region : ''}" placeholder="省 市 区"></div>
      <div class="form-field" style="margin:0 0 18px"><label>详细地址</label><textarea class="input" id="afDetail" placeholder="小区、楼栋、门牌号">${a ? esc(a.detail) : ''}</textarea></div>
      <button class="btn btn-primary btn-lg btn-block" data-save>保存地址</button>
    </div>`, true);
  m.querySelector('[data-save]').onclick = () => {
    const name = m.querySelector('#afName').value.trim();
    const phone = m.querySelector('#afPhone').value.trim();
    const region = m.querySelector('#afRegion').value.trim();
    const detail = m.querySelector('#afDetail').value.trim();
    if (!name || !phone || !region || !detail) return toast('请填写完整的地址信息', 'i-alert');
    if (a) Object.assign(a, { name, phone, region, detail });
    else S.addr.push({ id: 'a' + Date.now(), name, phone, region, detail, def: S.addr.length === 0 });
    closeModal(m);
    toast('地址已保存', 'i-check');
    render('address');
  };
}

/* ============ 21. 消息中心 ============ */
SCREENS.messages = {
  tab: 'messages',
  html() {
    return `
    <div class="screen has-tab">
      ${navbar('消息中心', { right: `<button class="nb-act" id="readAll" style="font-size:var(--fs-sm);color:var(--blue);width:auto;padding:0 8px">全部已读</button>` })}
      <div style="flex:1" class="card" >
        ${S.msgs.map(ms => `
          <button class="msg-item" data-msg="${ms.id}" style="width:100%;text-align:left">
            <div class="mi-icon" style="background:${ms.color}1A;color:${ms.color}">${ic(ms.icon)}${ms.unread ? '<span class="unread"></span>' : ''}</div>
            <div class="li-body">
              <div class="li-title" style="font-size:var(--fs-md)">${ms.title}</div>
              <p>${ms.text}</p>
            </div>
            <time>${ms.time}</time>
          </button>`).join('')}
      </div>
      <div style="height:16px"></div>
    </div>`;
  },
  mount() {
    bindBack(app);
    $('#readAll').onclick = () => { S.msgs.forEach(ms => ms.unread = false); render('messages'); toast('已全部标记为已读', 'i-check'); };
    app.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => {
      const ms = S.msgs.find(x => x.id === b.dataset.msg);
      ms.unread = false;
      go('msg-detail', { id: ms.id });
    });
  }
};

/* ============ 21b. 消息详情 ============ */
SCREENS['msg-detail'] = {
  html(p) {
    const ms = S.msgs.find(x => x.id === p.id) || {};
    return `
    <div class="screen">
      ${navbar('消息详情')}
      <div class="msg-detail">
        <div class="md-head">
          <div class="md-icon" style="background:${ms.color}1A;color:${ms.color}">${ic(ms.icon)}</div>
          <span class="md-tag" style="background:${ms.color}1A;color:${ms.color}">${ms.kindLabel || '通知'}</span>
        </div>
        <h2 class="md-title">${ms.title}</h2>
        <div class="md-meta">${ic('i-clock')}<span>${ms.date || ''}　${ms.time}</span></div>
        <div class="md-body">${(ms.detail || ms.text || '').split('\n').map(l => l.trim() ? `<p>${l}</p>` : '').join('')}</div>
      </div>
    </div>`;
  },
  mount(p) {
    bindBack(app);
  }
};

/* ============ 21c. 反诈资讯列表 ============ */
const NEWS_PAGE_SIZE = 5;
SCREENS['news-list'] = {
  html() {
    S.newsPage = 1; S.newsLoading = false; S.newsNoMore = NEWS.length <= NEWS_PAGE_SIZE;
    const list = NEWS.slice(0, NEWS_PAGE_SIZE);
    return `
    <div class="screen" id="newsListScreen">
      ${navbar('反诈资讯', { right: `<button class="nb-act" id="newsRefresh" style="width:auto;padding:0 8px;color:var(--blue)">${ic('i-refresh')}</button>` })}
      <div id="newsPullTip" class="pull-tip">${ic('i-refresh')}<span>下拉刷新</span></div>
      <div class="news-list" id="newsListBody">
        ${list.map(n => newsItemHtml(n)).join('')}
      </div>
      <div id="newsFoot" class="list-foot">${S.newsNoMore ? '没有更多资讯了' : '<span class="lf-spin"></span>加载中…'}</div>
    </div>`;
  },
  mount() {
    bindBack(app);
    const scr = $('#newsListScreen');
    const tip = $('#newsPullTip');
    let touchY = 0, pulling = false, pullDist = 0;

    /* 下拉刷新 — touch 事件实现 */
    scr.addEventListener('touchstart', e => {
      touchY = e.touches[0].clientY;
      pulling = scr.scrollTop <= 0;
    }, { passive: true });
    scr.addEventListener('touchmove', e => {
      if (!pulling || newsPulling || S.newsLoading) return;
      pullDist = Math.min(e.touches[0].clientY - touchY, 80);
      if (pullDist > 0) {
        tip.style.transform = `translateY(${pullDist}px)`;
        tip.style.opacity = Math.min(pullDist / 60, 1);
        tip.querySelector('span').textContent = pullDist >= 55 ? '释放刷新' : '下拉刷新';
      }
    }, { passive: true });
    scr.addEventListener('touchend', () => {
      if (pulling && pullDist >= 55 && !newsPulling && !S.newsLoading) {
        doRefreshNews();
      } else {
        tip.style.transform = '';
        tip.style.opacity = '';
      }
      pulling = false; pullDist = 0;
    });

    /* 上拉加载 */
    scr.addEventListener('scroll', () => {
      if (!S.newsLoading && !S.newsNoMore) {
        const max = scr.scrollHeight - scr.clientHeight;
        if (scr.scrollTop >= max - 80) loadMoreNews();
      }
    });

    bindNewsItemClicks();
    $('#newsRefresh').onclick = () => { if (!newsPulling && !S.newsLoading) doRefreshNews(); };
  }
};

function newsItemHtml(n) {
  return `
  <button class="news-item" data-news="${n.id}">
    <div class="news-cover" style="background:${n.color}">${ic(n.icon)}</div>
    <div class="news-body">
      <div class="news-title">${n.title}</div>
      <div class="news-meta">${n.meta}</div>
    </div>
    ${ic('i-right', 'news-arrow')}
  </button>`;
}

function bindNewsItemClicks() {
  app.querySelectorAll('[data-news]').forEach(b => b.onclick = () => go('news-detail', { id: b.dataset.news }));
}

function doRefreshNews() {
  S.newsLoading = true;
  const tip = $('#newsPullTip');
  if (tip) { newsPulling = true; tip.querySelector('span').textContent = '刷新中…'; }
  tick(() => {
    S.newsPage = 1; S.newsNoMore = NEWS.length <= NEWS_PAGE_SIZE;
    const list = NEWS.slice(0, NEWS_PAGE_SIZE);
    const body = $('#newsListBody');
    if (body) body.innerHTML = list.map(n => newsItemHtml(n)).join('');
    const foot = $('#newsFoot');
    if (foot) foot.innerHTML = S.newsNoMore ? '没有更多资讯了' : '<span class="lf-spin"></span>加载中…';
    S.newsLoading = false; newsPulling = false;
    if (tip) { tip.style.transform = ''; tip.style.opacity = ''; }
    bindNewsItemClicks();
    toast('已刷新', 'i-check');
  }, 800);
}

function loadMoreNews() {
  S.newsLoading = true;
  const foot = $('#newsFoot');
  if (foot) foot.innerHTML = '<span class="lf-spin"></span>加载中…';
  tick(() => {
    S.newsPage++;
    const start = (S.newsPage - 1) * NEWS_PAGE_SIZE;
    const batch = NEWS.slice(start, start + NEWS_PAGE_SIZE);
    if (batch.length < NEWS_PAGE_SIZE) S.newsNoMore = true;
    const body = $('#newsListBody');
    if (body) body.insertAdjacentHTML('beforeend', batch.map(n => newsItemHtml(n)).join(''));
    if (foot) foot.innerHTML = S.newsNoMore ? '没有更多资讯了' : '<span class="lf-spin"></span>上拉加载更多';
    S.newsLoading = false;
    bindNewsItemClicks();
  }, 600);
}

/* ============ 21d. 反诈资讯详情 ============ */
SCREENS['news-detail'] = {
  html(p) {
    const n = NEWS.find(x => x.id === p.id) || {};
    return `
    <div class="screen">
      ${navbar('资讯详情')}
      <div class="news-detail">
        <div class="nd-cover" style="background:${n.color}">${ic(n.icon || 'i-doc')}</div>
        <h1 class="nd-title">${n.title}</h1>
        <div class="nd-meta">
          <span class="nd-source">${n.source || ''}</span>
          <span class="nd-dot">·</span>
          <span>${n.date || ''}</span>
        </div>
        <div class="nd-summary">${n.summary || ''}</div>
        <div class="nd-body">${(n.content || '').split('\n').map(l => l.trim() ? `<p>${l}</p>` : '').join('')}</div>
      </div>
    </div>`;
  },
  mount() { bindBack(app); }
};

/* ============ 22. 求助/守护记录 ============ */
SCREENS.records = {
  html() {
    const isGuard = S.role === 'guardian';
    return `
    <div class="screen">
      ${navbar(isGuard ? '守护记录' : '求助记录')}
      <div style="flex:1;padding-bottom:20px">
        ${S.records.map(r => {
          const lvName = LEVELS[r.lv - 1] ? `${r.lv}级${LEVELS[r.lv - 1].name}` : `L${r.lv}`;
          const tagCls = r.star >= 4 ? 'tag-green' : 'tag-red';
          return `
          <div class="record-item">
            <div class="ri-top">${ic('i-shield')}<b>${r.type}</b><time>${r.time}</time></div>
            <div class="ri-rows">
              ${isGuard ? `求助者：<b>${r.seeker}</b>　通话时长：<b>${r.dur}</b>` : `守护者：<b>${r.guardName}</b>　等级：<b>${lvName}</b>　通话时长：<b>${r.dur}</b>`}
            </div>
            <div class="ri-stars">
              ${[1, 2, 3, 4, 5].map(i => ic('i-star', i <= r.star ? '' : 'off')).join('')}
              <span style="font-size:var(--fs-sm);color:var(--ink-3);margin-left:6px">${r.star}.0 分</span>
            </div>
            ${r.tags && r.tags.length ? `<div class="ri-tags">${r.tags.map(t => `<span class="tag-mini ${tagCls}">${t}</span>`).join('')}</div>` : ''}
            ${r.feedback ? `<div class="ri-feedback">${ic('i-msg')}<span>${r.feedback}</span></div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  },
  mount() { bindBack(app); }
};

/* ============ 23. 我的 ============ */
SCREENS.profile = {
  tab: 'profile',
  html() {
    const isGuard = S.role === 'guardian';
    const g = S.guard;
    const lv = LEVELS[g.level - 1];
    const grade = CREDIT_GRADES.find(c => g.credit >= c.min && g.credit <= c.max);
    const menu = [
      ...(isGuard ? [
        ['credit', 'i-credit', '#185FA5', '信用中心', `${g.credit} 分 · ${grade.g} 级`],
        ['level', 'i-medal', '#B8860B', '我的等级', `L${g.level} ${lv.name}`],
        ['tags-manage', 'i-tag', '#0F6E56', '能力标签', `${g.tags.length} 个已认证`],
        ['orders', 'i-gift', '#B4610E', '兑换订单', ''],
        ['address', 'i-loc', '#D6336C', '收货地址', ''],
      ] : []),
      ['records', 'i-doc', '#0B7285', isGuard ? '守护记录' : '求助记录', `${S.records.length} 条记录`],
      ['report-clue', 'i-megaphone', '#854F0B', '举报诈骗线索', '提供线索，协助反诈'],
      ['account-security', 'i-lock', '#5A6B84', '账号与安全', '换绑手机 · 解绑第三方'],
      ['service', 'i-headset', '#5A6B84', '客服中心', '96110 · 客服热线 · 投诉建议'],
      ['switch-role', 'i-refresh', '#6C5CE7', '切换身份', isGuard ? '当前：守护者' : '当前：求助者'],
      ['about', 'i-info', '#5A6B84', '关于我们', ''],
    ];
    return `
    <div class="screen has-tab">
      <div class="me-hero">
        <div class="me-top">
          <div class="me-avatar">${ic(isGuard ? 'i-shield' : 'i-user')}</div>
          <div>
            <h2>${isGuard ? g.name : S.seeker.name}</h2>
            <div class="me-badges">
              ${isGuard
                ? `<span class="tag-mini">L${g.level} ${lv.name}</span><span class="tag-mini">信用 ${grade.g}</span><span class="tag-mini">已实名认证</span>`
                : '<span class="tag-mini">求助者</span><span class="tag-mini">已登录</span>'}
            </div>
          </div>
        </div>
      </div>
      <div class="me-stats">
        <button data-ms="${isGuard ? 'points' : 'report'}"><b style="color:var(--gold)">${isGuard ? fmt(g.points) : '0'}</b><span>${isGuard ? '我的积分' : '举报线索'}</span></button>
        <button data-ms="records"><b style="color:var(--blue)">${isGuard ? g.helps : S.records.length}</b><span>${isGuard ? '累计守护' : '求助次数'}</span></button>
        <button data-ms="msgs"><b style="color:var(--green)">${S.msgs.filter(m => m.unread).length}</b><span>未读消息</span></button>
      </div>
      <div class="me-menu">
        ${menu.map(([id, icon, color, title, sub]) => `
          <button class="list-item" data-menu="${id}" style="width:100%">
            <div class="li-icon" style="background:${color}1A;color:${color}">${ic(icon)}</div>
            <div class="li-body"><div class="li-title">${title}</div>${sub ? `<div class="li-sub">${sub}</div>` : ''}</div>
            <span class="li-right">${ic('i-right')}</span>
          </button>`).join('')}
      </div>

      <div class="account-section">
        <button class="btn btn-logout btn-lg btn-block" id="logoutBtn">${ic('i-power')} 退出登录</button>
        <div class="me-footer">v1.0 · 链域科技</div>
      </div>
    </div>`;
  },
  mount() {
    app.querySelectorAll('[data-menu]').forEach(b => b.onclick = () => {
      const id = b.dataset.menu;
      if (id === 'switch-role') return switchRole();
      if (id === 'about') return go('about');
      go(id);
    });
    app.querySelectorAll('[data-ms]').forEach(b => b.onclick = () => {
      const k = b.dataset.ms;
      if (k === 'points') resetTo('mall');
      else if (k === 'records') go('records');
      else if (k === 'report') go('report-clue');
      else resetTo('messages');
    });
    $('#logoutBtn').onclick = () => confirmDlg('退出登录', '退出后需重新登录才能使用守护服务', '退出', () => {
      S.role = null; S.guard.online = false;
      resetTo('login');
    }, true);
  }
};

/* ============ 23b. 关于我们 ============ */
SCREENS.about = {
  html() {
    return `
    <div class="screen">
      ${navbar('关于我们')}
      <div style="text-align:center;padding:40px 20px 20px">
        <div class="about-logo">${ic('i-shield')}</div>
        <h2 style="font-size:var(--fs-xl);margin-top:12px">反诈守护</h2>
        <p style="font-size:var(--fs-sm);color:var(--ink-4);margin-top:4px">v1.0.0 · 链域科技</p>
      </div>
      <div style="margin:0 16px" class="card">
        <div class="list-item" style="padding:14px 16px">
          <div class="li-body"><div class="li-title">应用简介</div></div>
        </div>
        <div style="padding:0 16px 16px;font-size:var(--fs-sm);color:var(--ink-2);line-height:1.9">
          反诈守护是一款由链域科技开发的全民反诈公益应用，致力于构建"求助者-守护者"双向守护网络。通过实时视频守护、信用评价体系、积分激励等机制，让每一位用户都能成为反诈防线的一环。
        </div>
      </div>
      <div style="margin:12px 16px" class="card">
        <button class="list-item" style="width:100%;padding:14px 16px">
          <div class="li-icon" style="background:var(--blue-l);color:var(--blue)">${ic('i-doc')}</div>
          <div class="li-body"><div class="li-title">用户协议</div></div>
          <span class="li-right">${ic('i-right')}</span>
        </button>
        <button class="list-item" style="width:100%;padding:14px 16px">
          <div class="li-icon" style="background:var(--green-l);color:var(--green)">${ic('i-lock')}</div>
          <div class="li-body"><div class="li-title">隐私政策</div></div>
          <span class="li-right">${ic('i-right')}</span>
        </button>
        <button class="list-item" id="checkUpdateBtn" style="width:100%;padding:14px 16px">
          <div class="li-icon" style="background:var(--green-l);color:var(--green)">${ic('i-refresh')}</div>
          <div class="li-body"><div class="li-title">检查更新</div><div class="li-sub">当前版本 v1.0.0</div></div>
          <span class="li-right">${ic('i-right')}</span>
        </button>
      </div>
      <p style="text-align:center;font-size:var(--fs-xs);color:var(--ink-4);padding:20px 0 40px">© 2026 链域科技 · 保留所有权利<br>反诈守护，让天下无诈</p>
    </div>`;
  },
  mount() {
    bindBack(app);
    $('#checkUpdateBtn').onclick = () => checkUpdate();
  }
};

/* 检查更新 */
function checkUpdate() {
  const m = openModal(`
    <div class="sheet-panel">
      <div class="sheet-handle"></div>
      <div style="text-align:center;padding:8px 0 20px">
        <span class="lf-spin" style="width:32px;height:32px;border-width:3px;margin-bottom:14px"></span>
        <h3>正在检查更新…</h3>
        <p style="font-size:var(--fs-sm);color:var(--ink-3);margin-top:6px">当前版本 v1.0.0</p>
      </div>
    </div>`, true);
  tick(() => {
    closeModal(m);
    toast('当前已是最新版本 v1.0.0', 'i-check');
  }, 1800);
}

function switchRole() {
  const m = openModal(`
    <div class="sheet-panel">
      <div class="sheet-handle"></div>
      <h3 style="margin-bottom:16px">切换身份</h3>
      <button class="type-card" style="margin:0 0 10px;width:100%" data-sw="seeker">
        <div class="tc-icon" style="background:var(--blue)">${ic('i-user')}</div>
        <div style="flex:1"><h3>求助者</h3><p>发起求助、评价服务、举报线索</p></div>
        ${S.role === 'seeker' ? '<span class="tag-mini tag-blue">当前</span>' : ''}
      </button>
      <button class="type-card" style="margin:0 0 6px;width:100%" data-sw="guardian">
        <div class="tc-icon" style="background:var(--green)">${ic('i-shield')}</div>
        <div style="flex:1"><h3>守护者</h3><p>${S.guard.authed ? '在线接单、等级信用、积分激励' : '需先完成三步认证'}</p></div>
        ${S.role === 'guardian' ? '<span class="tag-mini tag-green">当前</span>' : ''}
      </button>
    </div>`, true);
  m.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => {
    closeModal(m);
    const r = b.dataset.sw;
    if (r === 'seeker') { S.role = 'seeker'; S.guard.online = false; toast('已切换为求助者身份', 'i-check'); resetTo('home'); }
    else if (S.guard.authed) { S.role = 'guardian'; toast('已切换为守护者身份', 'i-check'); resetTo('guard'); }
    else { toast('首次切换为守护者，请完成三步认证', 'i-alert'); go('auth-name'); }
  });
}

/* ============ 23b. 账号与安全 ============ */
SCREENS['account-security'] = {
  html() {
    const a = S.account;
    const boundCount = (a.phone ? 1 : 0) + (a.wechat ? 1 : 0) + (a.apple ? 1 : 0);
    return `
    <div class="screen">
      ${navbar('账号与安全')}
      <div class="proto-note">解绑前须保证账号至少保留一种可用登录方式，否则将无法登录。换绑手机号需验证新号码。</div>

      <div class="sec-title">登录方式</div>
      <div style="margin:0 16px" class="card">
        <button class="list-item" id="rebindPhone" style="width:100%">
          <div class="li-icon" style="background:var(--blue-l);color:var(--blue)">${ic('i-phone')}</div>
          <div class="li-body">
            <div class="li-title">手机号</div>
            <div class="li-sub">${a.phone || '未绑定'}</div>
          </div>
          <span class="li-right" style="color:var(--blue);font-size:var(--fs-sm)">${a.phone ? '换绑' : '绑定'}</span>
        </button>
        <button class="list-item" id="toggleWechat" style="width:100%">
          <div class="li-icon" style="background:#07C1601A;color:#07C160">${ic('i-wechat')}</div>
          <div class="li-body">
            <div class="li-title">微信</div>
            <div class="li-sub">${a.wechat ? '已绑定' : '未绑定'}</div>
          </div>
          <span class="li-right" style="color:${a.wechat ? 'var(--ink-4)' : 'var(--blue)'};font-size:var(--fs-sm)">${a.wechat ? '解绑' : '绑定'}</span>
        </button>
        <button class="list-item" id="toggleApple" style="width:100%">
          <div class="li-icon" style="background:var(--ink-3);color:#fff">${ic('i-apple')}</div>
          <div class="li-body">
            <div class="li-title">Apple</div>
            <div class="li-sub">${a.apple ? '已绑定' : '未绑定'}</div>
          </div>
          <span class="li-right" style="color:${a.apple ? 'var(--ink-4)' : 'var(--blue)'};font-size:var(--fs-sm)">${a.apple ? '解绑' : '绑定'}</span>
        </button>
      </div>

      <div class="sec-title">安全提示</div>
      <div style="margin:0 16px 20px;padding:14px 16px" class="card">
        <div style="font-size:var(--fs-sm);color:var(--ink-2);line-height:1.9">
          ${ic('i-shield')}<b style="color:var(--ink)">当前已绑定 ${boundCount} 种登录方式</b><br>
          · 换绑手机号需接收新手机号的验证码<br>
          · 解绑第三方账号后，将无法使用该方式登录<br>
          · 账号至少保留一种登录方式，否则无法解绑
        </div>
      </div>

      <div class="sec-title">账号操作</div>
      <div style="margin:0 16px 20px" class="card">
        <button class="list-item" id="deleteAccountBtn" style="width:100%">
          <div class="li-icon" style="background:var(--red-l);color:var(--red)">${ic('i-trash')}</div>
          <div class="li-body"><div class="li-title" style="color:var(--red)">注销账号</div><div class="li-sub">永久删除账号及所有数据，不可恢复</div></div>
          <span class="li-right">${ic('i-right')}</span>
        </button>
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    $('#rebindPhone').onclick = () => showRebindPhone();
    $('#toggleWechat').onclick = () => {
      if (S.account.wechat) tryUnbind('wechat');
      else bindThird('微信', 'wechat');
    };
    $('#toggleApple').onclick = () => {
      if (S.account.apple) tryUnbind('apple');
      else bindThird('Apple', 'apple');
    };
    $('#deleteAccountBtn').onclick = showDeleteAccount;
  }
};

/* 统计已绑定登录方式数量 */
function boundLoginCount() {
  const a = S.account;
  return (a.phone ? 1 : 0) + (a.wechat ? 1 : 0) + (a.apple ? 1 : 0);
}

/* 换绑手机号 */
function showRebindPhone() {
  const m = openModal(`
    <div class="sheet-panel">
      <div class="sheet-handle"></div>
      <h3 style="margin-bottom:6px">换绑手机号</h3>
      <p style="font-size:var(--fs-sm);color:var(--ink-3);margin-bottom:16px">当前手机号：${S.account.phone}</p>
      <div class="form-field" style="margin:0 0 12px">
        <label>新手机号</label>
        <input class="input" id="npPhone" type="tel" maxlength="11" placeholder="请输入新手机号">
      </div>
      <div class="form-field" style="margin:0 0 18px">
        <label>验证码</label>
        <div class="input-row">
          <input class="input" id="npCode" type="tel" maxlength="6" placeholder="请输入6位验证码">
          <button class="code-btn" id="npCodeBtn">获取验证码</button>
        </div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" data-save>确认换绑</button>
    </div>`, true);
  let cool = 0;
  m.querySelector('#npCodeBtn').onclick = e => {
    const phone = m.querySelector('#npPhone').value.trim();
    if (!/^1\d{10}$/.test(phone)) return toast('请输入正确的 11 位手机号', 'i-alert');
    cool = 60;
    e.target.disabled = true;
    e.target.textContent = `${cool}s 后重发`;
    toast('验证码已发送（演示码：135790）', 'i-check');
    every(() => {
      cool--;
      if (cool <= 0) { m.querySelector('#npCodeBtn').disabled = false; m.querySelector('#npCodeBtn').textContent = '重新获取'; clearTimers(); }
      else m.querySelector('#npCodeBtn').textContent = `${cool}s 后重发`;
    }, 1000);
  };
  m.querySelector('[data-save]').onclick = () => {
    const phone = m.querySelector('#npPhone').value.trim();
    const code = m.querySelector('#npCode').value.trim();
    if (!/^1\d{10}$/.test(phone)) return toast('请输入正确的 11 位手机号', 'i-alert');
    if (!/^\d{6}$/.test(code)) return toast('请输入 6 位数字验证码', 'i-alert');
    S.account.phone = phone.slice(0, 3) + '****' + phone.slice(7);
    closeModal(m);
    toast('手机号换绑成功', 'i-check');
    render('account-security');
  };
}

/* 绑定第三方账号 */
function bindThird(name, key) {
  const m = openModal(`
    <div class="dialog">
      <div class="d-icon" style="background:var(--blue-l);color:var(--blue)">${ic(key === 'wechat' ? 'i-wechat' : 'i-apple')}</div>
      <h3>绑定${name}账号</h3>
      <div class="d-sub">即将跳转至${name}完成授权绑定</div>
      <div class="d-btns">
        <button class="btn btn-plain" data-x>取消</button>
        <button class="btn btn-primary" data-ok>前往授权</button>
      </div>
    </div>`);
  m.querySelector('[data-x]').onclick = () => closeModal(m);
  m.querySelector('[data-ok]').onclick = () => {
    closeModal(m);
    const btn = openModal(`
      <div class="dialog">
        <div class="result-badge" style="width:72px;height:72px;background:linear-gradient(135deg,#1E6FC0,#185FA5)">${ic('i-refresh')}</div>
        <h3>${name}授权中…</h3>
        <div class="d-sub">正在连接${name}，请稍候</div>
      </div>`);
    btn.dataset.lock = '1';
    tick(() => {
      closeModal(btn);
      S.account[key] = true;
      toast(`${name}账号绑定成功`, 'i-check');
      render('account-security');
    }, 1200);
  };
}

/* 解绑第三方账号（保证至少一种登录方式） */
function tryUnbind(key) {
  const name = key === 'wechat' ? '微信' : 'Apple';
  if (boundLoginCount() <= 1) {
    return toast('账号至少保留一种登录方式，无法解绑', 'i-alert');
  }
  confirmDlg(`解绑${name}`, `解绑后将无法使用${name}登录本账号，确定要解绑吗？`, '确认解绑', () => {
    S.account[key] = false;
    toast(`${name}已解绑`, 'i-check');
    render('account-security');
  }, true);
}

/* ============ 24. 客服中心 ============ */
SCREENS.service = {
  html() {
    return `
    <div class="screen">
      ${navbar('客服中心')}

      <div class="sec-title">紧急求助</div>
      <div style="margin:0 16px 14px">
        <button class="cs-emergency" id="call96110">
          <div class="cse-icon">${ic('i-phone')}</div>
          <div class="cse-body">
            <b>拨打反诈专线 96110</b>
            <span>疑似被骗请立即拨打，24小时值守</span>
          </div>
          <div class="cse-arrow">${ic('i-right')}</div>
        </button>
      </div>

      <div class="sec-title">联系客服</div>
      <div style="margin:0 16px 14px" class="card">
        <button class="list-item" id="callCs" style="width:100%">
          <div class="li-icon" style="background:var(--blue-l);color:var(--blue)">${ic('i-headset')}</div>
          <div class="li-body">
            <div class="li-title">拨打官方客服热线</div>
            <div class="li-sub">${SERVICE_HOTLINE} · 工作日 9:00-21:00</div>
          </div>
          <span class="li-right">${ic('i-phone')}</span>
        </button>
      </div>

      <div class="sec-title">帮助与反馈</div>
      <div style="margin:0 16px 20px" class="card">
        <button class="list-item" data-go="complaint" style="width:100%">
          <div class="li-icon" style="background:var(--orange-l);color:var(--orange-d)">${ic('i-edit')}</div>
          <div class="li-body">
            <div class="li-title">投诉与建议</div>
            <div class="li-sub">提交投诉或产品改进建议，3 个工作日内反馈</div>
          </div>
          <span class="li-right">${ic('i-right')}</span>
        </button>
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    /* 直达投诉建议 */
    app.querySelectorAll('[data-go="complaint"]').forEach(b => b.onclick = () => go('complaint'));
    /* 96110 */
    $('#call96110').onclick = () => {
      confirmDlg('拨打反诈专线', '即将拨打全国统一反诈专线 96110，疑似被骗请立即拨打。', '立即拨打', () => {
        toast('原型演示：呼叫 96110（实际环境将调起系统拨号）', 'i-phone');
      });
    };
    /* 客服热线 */
    $('#callCs').onclick = () => {
      confirmDlg('拨打客服热线', `即将拨打官方客服热线 ${SERVICE_HOTLINE}，工作时段专人接听。`, '立即拨打', () => {
        toast('原型演示：呼叫客服热线（实际环境将调起系统拨号）', 'i-phone');
      });
    };
  }
};

/* ============ 24b. 投诉与建议 ============ */
SCREENS.complaint = {
  html() {
    return `
    <div class="screen">
      ${navbar('投诉与建议')}
      <div class="proto-note" style="margin:16px">感谢您的反馈！我们将认真对待每一条投诉与建议，通常在 3 个工作日内回复。请尽量详细描述，帮助我们更快定位问题。</div>

      <div class="sec-title">反馈类型</div>
      <div style="margin:0 16px 6px;padding:0 4px;display:flex;gap:8px;flex-wrap:wrap">
        ${COMPLAINT_TYPES.map(t => `<button class="chip ${complaintType === t.id ? 'on' : ''}" data-ct="${t.id}">${t.name}</button>`).join('')}
      </div>

      <div class="form-field" style="margin:16px">
        <label>详细描述 <span style="color:var(--red);font-weight:400">*</span></label>
        <textarea class="input" id="complaintText" rows="4" placeholder="请详细描述您遇到的问题或建议，包括发生时间、具体场景、期望的改进方式等"></textarea>
      </div>

      <div class="form-field" style="margin:0 16px 16px">
        <label>截图/附件（选填）</label>
        <button class="btn btn-ghost btn-block" id="uploadCmpEvidence">${ic('i-plus')}上传截图（最多3张）</button>
      </div>

      <div class="form-field" style="margin:0 16px 16px">
        <label>联系方式（选填）</label>
        <input class="input" id="complaintContact" placeholder="手机号或微信号，便于我们联系您">
      </div>

      <div class="bottom-cta">
        <button class="btn btn-primary btn-lg btn-block" id="submitComplaint">提交反馈</button>
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    app.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => {
      complaintType = b.dataset.ct;
      render('complaint');
    });
    $('#uploadCmpEvidence').onclick = () => toast('原型演示：图片上传占位');
    $('#submitComplaint').onclick = () => {
      if (!complaintType) return toast('请选择反馈类型', 'i-alert');
      if (!$('#complaintText').value.trim()) return toast('请填写详细描述', 'i-alert');
      complaintType = null;
      toast('感谢您的反馈，我们将在 3 个工作日内回复', 'i-check');
      tick(() => back(), 1000);
    };
  }
};

/* ============ 25. 举报诈骗线索 ============ */
SCREENS['report-clue'] = {
  html() {
    return `
    <div class="screen">
      ${navbar('举报诈骗线索')}
      <div class="proto-note" style="margin:16px">您提供的每一条线索都将帮助平台识别新型诈骗手法，保护更多人免受损失。举报信息将严格保密。</div>
      <div class="sec-title">诈骗类型</div>
      <div style="margin:0 16px 6px;padding:0 4px;display:flex;gap:8px;flex-wrap:wrap">
        ${FRAUD_TYPES.map(t => `<button class="chip ${reportType === t.id ? 'on' : ''}" data-rt="${t.id}">${t.name}</button>`).join('')}
      </div>
      <div class="form-field" style="margin:16px">
        <label>线索描述</label>
        <textarea class="input" id="clueText" rows="4" placeholder="请详细描述您遇到的疑似诈骗情况，包括：对方联系方式、诈骗手段、涉及金额等"></textarea>
      </div>
      <div class="form-field" style="margin:0 16px 16px">
        <label>证据截图（选填）</label>
        <button class="btn btn-ghost btn-block" id="uploadEvidence">${ic('i-plus')}上传截图/录音</button>
      </div>
      <div class="form-field" style="margin:0 16px 16px">
        <label>联系方式（选填）</label>
        <input class="input" id="clueContact" placeholder="手机号或微信号，便于核实">
      </div>
      <div class="bottom-cta">
        <button class="btn btn-primary btn-lg btn-block" id="submitClue">提交举报</button>
      </div>
    </div>`;
  },
  mount() {
    bindBack(app);
    app.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => {
      reportType = b.dataset.rt;
      render('report-clue');
    });
    $('#uploadEvidence').onclick = () => toast('原型演示：图片上传占位');
    $('#submitClue').onclick = () => {
      if (!reportType) return toast('请选择诈骗类型', 'i-alert');
      if (!$('#clueText').value.trim()) return toast('请描述线索内容', 'i-alert');
      const type = FRAUD_TYPES.find(t => t.id === reportType);
      toast('举报已提交，感谢您的贡献', 'i-check');
      reportType = null;
      tick(() => back(), 800);
    };
  }
};

/* ============ 26. 注销账号 ============ */
function showDeleteAccount() {
  const m = openModal(`
    <div class="dialog">
      <div class="d-icon" style="background:var(--red-l);color:var(--red)">${ic('i-ban')}</div>
      <h3>注销账号</h3>
      <div class="d-sub" style="text-align:left">
        注销后以下数据将被永久删除，不可恢复：<br>
        · 账号个人信息与实名认证<br>
        · 积分、等级、信用分<br>
        · 求助/守护记录与消息<br>
        · 兑换订单与收货地址
      </div>
      <div class="form-field" style="margin:16px 0">
        <label>注销原因（选填）</label>
        <select class="input" id="delReason">
          <option value="">请选择注销原因</option>
          <option>不再使用本服务</option>
          <option>隐私安全顾虑</option>
          <option>功能不满足需求</option>
          <option>其他</option>
        </select>
      </div>
      <div class="d-btns">
        <button class="btn btn-plain" data-x>取消</button>
        <button class="btn btn-danger" data-next>下一步</button>
      </div>
    </div>`);
  m.querySelector('[data-x]').onclick = () => closeModal(m);
  m.querySelector('[data-next]').onclick = () => {
    closeModal(m);
    const m2 = openModal(`
      <div class="dialog">
        <div class="d-icon" style="background:var(--red-l);color:var(--red)">${ic('i-ban')}</div>
        <h3 style="color:var(--red)">最终确认</h3>
        <div class="d-sub">请输入"确认注销"以完成操作<br>此操作不可逆，请谨慎操作</div>
        <div class="form-field" style="margin:16px 0">
          <input class="input" id="delConfirm" placeholder='请输入"确认注销"'>
        </div>
        <div class="d-btns">
          <button class="btn btn-plain" data-x>取消</button>
          <button class="btn btn-danger" data-ok disabled>确认注销</button>
        </div>
      </div>`);
    m2.querySelector('[data-x]').onclick = () => closeModal(m2);
    const input = m2.querySelector('#delConfirm');
    const okBtn = m2.querySelector('[data-ok]');
    input.oninput = () => { okBtn.disabled = input.value.trim() !== '确认注销'; };
    okBtn.onclick = () => {
      closeModal(m2);
      S.role = null;
      S.guard.online = false;
      S.guard.authed = false;
      S.agreed = false;
      const m3 = openModal(`
        <div class="dialog">
          <div class="result-badge" style="width:80px;height:80px;background:linear-gradient(135deg,#C84B3C,#A32D2D)">${ic('i-check')}</div>
          <h3>账号已注销</h3>
          <div class="d-sub">您的账号已成功注销<br>感谢您曾经使用反诈守护</div>
          <div class="d-btns"><button class="btn btn-primary" data-ok>返回登录</button></div>
        </div>`);
      m3.dataset.lock = '1';
      m3.querySelector('[data-ok]').onclick = () => { closeModal(m3); resetTo('login'); };
    };
  };
}

/* ============================================================
   启动
   ============================================================ */
function boot() {
  /* 状态栏实时时钟 */
  const setTime = () => {
    const d = new Date();
    $('#sbTime').textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  setTime(); setInterval(setTime, 20000);
  /* 首次启动：隐私协议 → 登录 */
  stack = ['login'];
  render('login');
  showPrivacy(true);
}
boot();
