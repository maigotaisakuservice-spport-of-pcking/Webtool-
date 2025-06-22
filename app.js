(() => {
  // --- 共通機能: タブ切替 ---
  const tabs = document.querySelectorAll("#tab-nav button");
  const panels = document.querySelectorAll(".tab-panel");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.setAttribute("aria-selected", "false"));
      tab.setAttribute("aria-selected", "true");
      const tabNum = tab.dataset.tab;
      panels.forEach(panel => panel.classList.toggle("active", panel.id === `tab${tabNum}`));
    });
  });

  // --- 通知機能 ---
  async function requestNotificationPermission() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission !== "denied") {
      const perm = await Notification.requestPermission();
      return perm === "granted";
    }
    return false;
  }
  window.notifyUser = async (title, options) => {
    if (await requestNotificationPermission()) new Notification(title, options);
  };

  // --- P2P共有 (BroadcastChannel) ---
  const shareChannel = new BroadcastChannel("multi_tool_share");
  const shareHandlers = {};
  shareChannel.onmessage = e => {
    const { tool, action, payload } = e.data;
    if (shareHandlers[tool]) shareHandlers[tool](action, payload);
  };
  function shareData(tool, action, payload) {
    shareChannel.postMessage({ tool, action, payload });
  }

  // ---------------- ツール初期化関数 ----------------
  // 1. AI文章リライト
  function initRewriteTool() {
    const p = document.getElementById("tab1");
    p.innerHTML = `
      <div class="tool-section">
        <textarea id="rewrite-input" rows="6" placeholder="文章を入力"></textarea>
        <select id="style-select">
          <option value="formal">フォーマル</option>
          <option value="casual">カジュアル</option>
          <option value="business">ビジネス</option>
          <option value="academic">学術的</option>
        </select>
        <button id="rewrite-btn">リライト</button>
        <textarea id="rewrite-output" rows="6" readonly></textarea>
      </div>
    `;
    const inp = p.querySelector("#rewrite-input"), out = p.querySelector("#rewrite-output");
    p.querySelector("#rewrite-btn").onclick = () => {
      const text = inp.value.trim(), style = p.querySelector("#style-select").value;
      if (!text) return alert("文章を入力してください");
      // 簡易リライトロジック
      let res = text.replace(/\s+/, ' ');
      if (style === "formal") res = res.replace(/\b(I|I'm)\b/g, "One");
      else if (style === "casual") res = res.replace(/\bdo not\b/g, "don't").replace(/\bare not\b/g, "aren't");
      else if (style === "business") res = res.replace(/\bhelp\b/g, "assist").replace(/\bget\b/g, "obtain");
      else if (style === "academic") res = res.replace(/\bthink\b/g, "consider").replace(/\bshow\b/g, "demonstrate");
      out.value = res;
      notifyUser("リライト完了", { body: "リライトが完了しました。" });
      shareData("rewrite", "done", { text: res });
    };
  }
  shareHandlers["rewrite"] = () => {};

  // 2. 画像ノートOCR & 構成チェック (Tesseract.js)
  function initImageNoteTool() {
    const p = document.getElementById("tab2");
    p.innerHTML = `
      <div class="tool-section">
        <input type="file" id="ocr-file" accept="image/*">
        <button id="ocr-btn">OCR実行</button>
        <div id="ocr-result"></div>
      </div>
    `;
    const fileInput = p.querySelector("#ocr-file"), btn = p.querySelector("#ocr-btn"), resDiv = p.querySelector("#ocr-result");
    btn.onclick = async () => {
      if (!fileInput.files.length) return alert("画像を選択してください");
      const file = fileInput.files[0];
      const { createWorker } = Tesseract;
      const worker = createWorker({ logger: m => console.log(m) });
      await worker.load(); await worker.loadLanguage('eng+jpn'); await worker.initialize('eng+jpn');
      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();
      const lines = text.split(/\n+/).filter(l => l.trim());
      resDiv.innerHTML = `<h3>OCR結果</h3><pre>${text}</pre>`;
      // 簡易構成ミスチェック: 行末ピリオド判定
      const issues = lines.map((l,i) => (!/[\.!?]$/.test(l) ? i+1 : null)).filter(i=>i);
      if (issues.length) resDiv.innerHTML += `<p>行${issues.join(', ')}に終端句読点がありません。</p>`;
      notifyUser("OCR完了", { body: "テキスト抽出が完了しました。" });
    };
  }
  shareHandlers["ocr"] = () => {};

  // 3. マイクロタイマー
  function initTimerTool() {
    const p = document.getElementById("tab3");
    p.innerHTML = `
      <div class="tool-section">
        <input type="number" id="timer-input" min="1" max="3600" value="5">
        <button id="timer-start">開始</button>
        <button id="timer-stop" disabled>停止</button>
        <div class="timer-display" id="timer-display">0</div>
      </div>
    `;
    const inp = p.querySelector("#timer-input"), start = p.querySelector("#timer-start"), stop = p.querySelector("#timer-stop"), disp = p.querySelector("#timer-display");
    let id=null, rem=0;
    start.onclick = () => {
      rem = +inp.value; if (!rem) return alert("秒数を入力"); disp.textContent = rem;
      notifyUser("タイマー開始", { body: `${rem}秒スタート` });
      id = setInterval(() => { rem--; disp.textContent = rem; if(rem<=0){ clearInterval(id); notifyUser("タイマー終了"); start.disabled=false; stop.disabled=true; } },1000);
      start.disabled=true; stop.disabled=false;
      shareData("timer","start",{rem});
    };
    stop.onclick = () => { clearInterval(id); disp.textContent=0; start.disabled=false; stop.disabled=true; notifyUser("タイマー停止"); shareData("timer","stop",{}); };
    shareHandlers["timer"] = (act,pay) => {
      if(act==="start"&&!id){ rem=pay.rem; disp.textContent=rem; start.disabled=true; stop.disabled=false; id=setInterval(() => { rem--; disp.textContent=rem; if(rem<=0){ clearInterval(id); start.disabled=false; stop.disabled=true; notifyUser("(共有)タイマー終了"); } },1000);} else if(act==="stop"){ clearInterval(id); disp.textContent=0; start.disabled=false; stop.disabled=true;} }
  }

  // 4. QRコード生成 (qrcodejs)
  function initQRTool() {
    const p = document.getElementById("tab4");
    p.innerHTML = `
      <div class="tool-section">
        <textarea id="qr-input" rows="2" placeholder="URLやテキスト"></textarea>
        <button id="qr-btn">生成</button>
        <div id="qr-result"></div>
      </div>
    `;
    const inp = p.querySelector("#qr-input"), btn = p.querySelector("#qr-btn"), res = p.querySelector("#qr-result");
    btn.onclick = () => {
      res.innerHTML = "";
      if(!inp.value.trim()) return alert("テキストを入力");
      new QRCode(res, { text: inp.value.trim(), width: 200, height: 200 });
      notifyUser("QR生成完了");
      shareData("qr","gen",{text:inp.value.trim()});
    };
    shareHandlers["qr"] = (act,pay) => { if(act==="gen"){ inp.value=pay.text; btn.click(); }};
  }

  // 5. 学習進捗マップ (ツリー表示、簡易版)
  function initProgressMap() {
    const p = document.getElementById("tab5");
    p.innerHTML = `<div class="tool-section"><h3>学習進捗ツリー</h3><div id="tree-container"></div><button id="add-node-btn">ノード追加</button></div>`;
    const cont = p.querySelector("#tree-container"), addBtn = p.querySelector("#add-node-btn");
    let tree = JSON.parse(localStorage.getItem("progress_tree")||'{"id":"root","name":"目標","children":[]}');
    function saveTree(){ localStorage.setItem("progress_tree",JSON.stringify(tree)); notifyUser("マップ更新"); shareData("map","update",{tree}); render(); }
    function render(){ cont.innerHTML="";
      function renderNode(node,el){
        const div=document.createElement("div"); div.style.marginLeft="20px";
        const chk=document.createElement("input"); chk.type="checkbox"; chk.checked=!!node.done; chk.onchange=()=>{ node.done=chk.checked; saveTree(); };
        div.append(chk, document.createTextNode(node.name)); el.append(div);
        if(node.children) node.children.forEach(c=>renderNode(c,div));
      }
      renderNode(tree,cont);
    }
    addBtn.onclick=()=>{ const name=prompt("ノード名を入力"); if(name){ const id=Date.now().toString(); tree.children.push({id,name,done:false,children:[]}); saveTree(); }};
    shareHandlers["map"]=(act,pay)=>{ if(act==="update"){ tree=pay.tree; localStorage.setItem("progress_tree",JSON.stringify(tree)); render(); }};
    render();
  }

  // 6. 音声→文字起こし＋要約 (Web Speech API + 簡易要約)
  function initSpeechTool() {
    const p = document.getElementById("tab6");
    p.innerHTML = `<div class="tool-section"><button id="sr-start">録音開始</button><button id="sr-stop" disabled>停止</button><h3>文字起こし</h3><div id="sr-text"></div><h3>要約</h3><div id="sr-sum"></div></div>`;
    const start=document.getElementById("sr-start"), stop=document.getElementById("sr-stop"), txt=document.getElementById("sr-text"), sum=document.getElementById("sr-sum");
    const SpeechRecognition = window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SpeechRecognition) return txt.textContent="対応ブラウザが必要";
    const rec=new SpeechRecognition(); rec.continuous=true; rec.lang="ja-JP"; let final="";
    rec.onresult=e=>{ for(let i=e.resultIndex;i<e.results.length;i++){ if(e.results[i].isFinal){ final+=e.results[i][0].transcript; txt.textContent=final; sum.textContent=summarize(final);} }};
    start.onclick=()=>{ rec.start(); start.disabled=true; stop.disabled=false; };
    stop.onclick=()=>{ rec.stop(); start.disabled=false; stop.disabled=true; notifyUser("録音停止"); };
    function summarize(text){ const sents=text.split(/[。！？]/).filter(s=>s); return sents.slice(0,3).join('。')+'。'; }
  }

  // 7. 画像圧縮＆変換 (Canvas)
  function initImageCompressTool() {
    const p = document.getElementById("tab7");
    p.innerHTML = `<div class="tool-section"><input type="file" id="img-file" accept="image/*"><label>形式<select id="img-format"><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WEBP</option></select></label><label>品質<input type="range" id="img-quality" min="0.1" max="1" step="0.1" value="0.8"></label><button id="img-convert">変換</button><a id="img-download" download="converted" style="display:none">ダウンロード</a></div>`;
    const fileIn=p.querySelector("#img-file"), fmt=p.querySelector("#img-format"), q=p.querySelector("#img-quality"), btn=p.querySelector("#img-convert"), dl=p.querySelector("#img-download");
    btn.onclick=()=>{
      if(!fileIn.files.length) return alert("画像を選択");
      const file=fileIn.files[0], url=URL.createObjectURL(file);
      const img=new Image(); img.onload=()=>{
        const c=document.createElement("canvas"); c.width=img.width; c.height=img.height;
        const ctx=c.getContext("2d"); ctx.drawImage(img,0,0);
        c.toBlob(blob=>{ const u=URL.createObjectURL(blob); dl.href=u; dl.style.display="inline"; notifyUser("変換完了"); shareData("imgconv","done",{}); }, fmt.value, +q.value);
      };
      img.src=url;
    };
  }

  // 8. 音フェチメーカー (AudioContext)
  function initASMRTool() {
    const p = document.getElementById("tab8");
    p.innerHTML = `<div class="tool-section"><button id="load-sounds">読み込み</button><div id="asmr-controls"></div><button id="play-asmr">再生</button><button id="stop-asmr">停止</button></div>`;
    const loadBtn=p.querySelector("#load-sounds"), ctrls=p.querySelector("#asmr-controls"), play=p.querySelector("#play-asmr"), stop=p.querySelector("#stop-asmr");
    const ctx=new AudioContext(); let buffers={};
    const files=[{name:'water',url:'sounds/water.mp3'},{name:'typing',url:'sounds/typing.mp3'}];
    loadBtn.onclick=async()=>{ for(const f of files){ const r=await fetch(f.url); const ab=await r.arrayBuffer(); buffers[f.name]=await ctx.decodeAudioData(ab); const div=document.createElement('div'); div.innerHTML=`${f.name}: <input type="range" min="0" max="1" step="0.01" value="0.5" data-sound="${f.name}">`; ctrls.appendChild(div);} notifyUser("ASMR読み込み完了"); };
    let sources=[];
    play.onclick=()=>{ Object.entries(buffers).forEach(([k,b])=>{ const src=ctx.createBufferSource(); const gain=ctx.createGain(); src.buffer=b; gain.gain.value=+ctrls.querySelector(`[data-sound="${k}"]`).value; src.connect(gain).connect(ctx.destination); src.loop=true; src.start(); sources.push(src);} ); };
    stop.onclick=()=>{ sources.forEach(s=>s.stop()); sources=[]; notifyUser("ASMR停止"); };
  }

  // 9. 漢字力判定ゲーム
  function initKanjiGame() {
    const p = document.getElementById("tab9");
    p.innerHTML = `<div class="tool-section"><button id="kanji-start">開始</button><div id="kanji-q"></div><input id="kanji-ans"><button id="kanji-submit">解答</button><div id="kanji-result"></div></div>`;
    const qs=[{q:'薔薇',a:'ばら'},{q:'鬱',a:'うつ'}]; let cur;
    p.querySelector('#kanji-start').onclick=()=>{cur=qs[Math.floor(Math.random()*qs.length)]; p.querySelector('#kanji-q').textContent=cur.q; p.querySelector('#kanji-result').textContent=''; };
    p.querySelector('#kanji-submit').onclick=()=>{ const ans=p.querySelector('#kanji-ans').value.trim(); const res= ans===cur.a?'正解':'不正解'; p.querySelector('#kanji-result').textContent=res; notifyUser(`漢字力判定: ${res}`);}  }

  // 10. 決断シミュレーター
  function initDecisionSim() {
    const p = document.getElementById("tab10");
    p.innerHTML = `<div class="tool-section"><textarea id="dec-input" rows="3" placeholder="選択肢1,選択肢2 を入力"></textarea><button id="dec-btn">シミュレーション</button><div id="dec-output"></div></div>`;
    const inp=p.querySelector('#dec-input'), btn=p.querySelector('#dec-btn'), out=p.querySelector('#dec-output');
    btn.onclick=()=>{
      const parts=inp.value.split(','); if(parts.length<2) return alert('2つ以上カンマ区切りで');
      out.innerHTML='';
      parts.forEach((opt,i)=>{
        out.innerHTML+=`<h4>${opt.trim()}</h4><p>未来予想シナリオ ${opt.trim()}：...（AI連携想定）</p>`;
      }); notifyUser('シミュレート完了');
    };
  }

  // 11. Webメモ帳
  function initMemoTool() {
    const p = document.getElementById("tab11");
    p.innerHTML = `<div class="tool-section"><textarea id="memo-area" rows="15" placeholder="メモ"></textarea><button id="memo-save">保存</button><button id="memo-clear">クリア</button></div>`;
    const area=p.querySelector('#memo-area'), save=p.querySelector('#memo-save'), clr=p.querySelector('#memo-clear');
    const KEY='memo_text'; area.value=localStorage.getItem(KEY)||'';
    save.onclick=()=>{ localStorage.setItem(KEY,area.value); notifyUser('メモ保存'); shareData('memo','save',{text:area.value}); };
    clr.onclick=()=>{ if(confirm('クリア?')){ area.value=''; localStorage.removeItem(KEY); notifyUser('メモクリア'); shareData('memo','clear',{});} };
    shareHandlers['memo']=(act,p)=>{ if(act==='save'){ area.value=p.text; localStorage.setItem(KEY,p.text);} if(act==='clear'){ area.value=''; localStorage.removeItem(KEY);} };
  }

  // 12. カレンダー
  function initCalendarTool() {
    const p = document.getElementById("tab12");
    p.innerHTML = `<div class="tool-section"><div><button id="prev-month">←</button><span id="month-label"></span><button id="next-month">→</button></div><div id="cal-grid" class="calendar-grid"></div><div><input type="date" id="evt-date"><input type="text" id="evt-content" placeholder="イベント"><button id="evt-save">保存</button><button id="evt-del">削除</button></div></div>`;
    const today=new Date(), curY=today.getFullYear(), curM=today.getMonth(); let y=curY,m=curM;
    const grid=p.querySelector('#cal-grid'), label=p.querySelector('#month-label'), prevBtn=p.querySelector('#prev-month'), nextBtn=p.querySelector('#next-month');
    const dateIn=p.querySelector('#evt-date'), contIn=p.querySelector('#evt-content'), saveBtn=p.querySelector('#evt-save'), delBtn=p.querySelector('#evt-del');
    const KEY='calendar_events'; let evts=JSON.parse(localStorage.getItem(KEY)||'{}'), sel=null;
    function fmtDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
    function render(){ label.textContent=`${y}年${m+1}月`; grid.innerHTML=''; const first=new Date(y,m,1), last=new Date(y,m+1,0);
      for(let i=0;i<first.getDay();i++){ grid.appendChild(document.createElement('div')); }
      for(let d=1;d<=last.getDate();d++){ const cell=document.createElement('div'); cell.className='calendar-cell'; const ds=fmtDate(new Date(y,m,d)); cell.textContent=d; if(evts[ds]){ const div=document.createElement('div'); div.className='calendar-event'; div.textContent=evts[ds][0]; cell.appendChild(div);} cell.onclick=()=>{ sel=ds; dateIn.value=ds; contIn.value=evts[ds]?evts[ds][0]:''; }; grid.appendChild(cell);}    }
    prevBtn.onclick=()=>{ m--; if(m<0){m=11;y--;} render(); };
    nextBtn.onclick=()=>{ m++; if(m>11){m=0;y++;} render(); };
    saveBtn.onclick=()=>{ if(!sel) return alert('日付選択'); if(!contIn.value) return alert('内容'); evts[sel]=[contIn.value]; localStorage.setItem(KEY,JSON.stringify(evts)); notifyUser('イベント保存'); shareData('calendar','upd',{date:sel,content:contIn.value}); render(); };
    delBtn.onclick=()=>{ if(evts[sel]){ delete evts[sel]; localStorage.setItem(KEY,JSON.stringify(evts)); notifyUser('イベント削除'); shareData('calendar','del',{date:sel}); contIn.value=''; render(); }};
    shareHandlers['calendar']=(act,p)=>{ if(act==='upd'){ evts[p.date]=[p.content]; localStorage.setItem(KEY,JSON.stringify(evts)); if(p.date===sel) contIn.value=p.content; render(); } else if(act==='del'){ delete evts[p.date]; localStorage.setItem(KEY,JSON.stringify(evts)); if(p.date===sel) contIn.value=''; render(); }};
    render();
  }

  // --- 全初期化 ---
  const inits = [ initRewriteTool, initImageNoteTool, initTimerTool, initQRTool, initProgressMap, initSpeechTool, initImageCompressTool,
                  initASMRTool, initKanjiGame, initDecisionSim, initMemoTool, initCalendarTool ];
  document.addEventListener('DOMContentLoaded', () => inits.forEach(fn => fn()));
})();
