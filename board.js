// =====================================================
// 부스 공용 리더보드 (Firebase Firestore)
// - 같은 날 부스에서 한 모든 기록이 한 랭킹에 모여요. (날짜가 바뀌면 새 랭킹)
// - 인터넷이 안 되거나 Firebase를 못 불러오면 이 기기에 저장해 두었다가,
//   다음에 연결되면 자동으로 올려요.
// - 세 페이지(띄어쓰기, 우주정복자, TV 화면)가 이 파일을 똑같이 써요.
// =====================================================

// Firebase 콘솔 > 프로젝트 설정 > 내 앱 에 나오는 값이에요. (비밀번호가 아니라 공개 정보예요)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBUpOuOuS4TdpfNY36NcwipbELd3XlIhA0",
  authDomain: "leadder-d2ca1.firebaseapp.com",
  projectId: "leadder-d2ca1",
  storageBucket: "leadder-d2ca1.firebasestorage.app",
  messagingSenderId: "1085879784099",
  appId: "1:1085879784099:web:ac639fe43f585bddcd2516"
};
const FB_VERSION = '12.19.0';

// 한국 시간 기준 오늘 날짜 (예: 2026-11-27)
function boothDay(){ return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}); }

// Firebase는 한 페이지에서 한 번만 불러와요 (TV 화면처럼 랭킹 두 개를 함께 볼 때도)
let FB_READY = null;
function loadFirebase(){
  if(FB_READY) return FB_READY;
  FB_READY = (async ()=>{
    if(!FIREBASE_CONFIG) throw new Error('Firebase 설정이 없어요');
    const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
    const [app,fs] = await Promise.all([import(base+'firebase-app.js'),import(base+'firebase-firestore.js')]);
    const a = app.initializeApp(FIREBASE_CONFIG);
    let db;
    try{ db = fs.initializeFirestore(a,{localCache:fs.persistentLocalCache({tabManager:fs.persistentMultipleTabManager()})}); }
    catch(e){ db = fs.getFirestore(a); }
    return {fb:app,fs,app:a,db};
  })();
  return FB_READY;
}

function createBoard(col){
  const PKEY = 'booth-pending-'+col;   // 아직 서버에 못 올린 기록
  const LKEY = 'booth-local-'+col;     // 이 기기에서 한 기록 (인터넷이 없을 때 보여 줘요)
  const read = k=>{ try{ const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; }catch(e){ return []; } };
  const write = (k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} };

  const B = {
    online:false, failed:false, rows:[], subs:[], user:null,
    fb:null, fs:null, db:null, app:null,

    onChange(fn){ this.subs.push(fn); },
    emit(){ this.subs.forEach(f=>{ try{ f(); }catch(e){ console.error(e); } }); },

    // 오늘 기록 전체: 연결돼 있으면 서버 기록, 아니면 이 기기 기록
    today(){
      const d = boothDay();
      if(this.online) return [...this.rows, ...read(PKEY).filter(r=>r.day===d)];
      return read(LKEY).filter(r=>r.day===d);
    },

    // 새 기록 저장. 돌려주는 값(localId)으로 "방금 내 기록"을 찾아요.
    submit(fields){
      const localId = Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      const entry = {...fields, day:boothDay(), at:Date.now(), localId};
      write(LKEY,[...read(LKEY),entry].slice(-400));
      write(PKEY,[...read(PKEY),entry]);
      this.emit(); this.flush();
      return localId;
    },
    isMine(row,ids){
      if(!ids || !ids.length) return false;
      if(row.localId) return ids.includes(row.localId);
      return read(LKEY).some(e=>e.remoteId===row.id && ids.includes(e.localId));
    },

    // 못 올린 기록을 서버로 보내요. (Firestore가 인터넷이 끊겨도 기기에 보관했다가 알아서 보내 줘요)
    flush(){
      if(!this.online) return;
      const fs = this.fs, list = read(PKEY);
      if(!list.length) return;
      const local = read(LKEY);
      list.forEach(e=>{
        const {localId, at, day, remoteId, ...fields} = e;
        const ref = fs.doc(fs.collection(this.db,col));
        fs.setDoc(ref,{...fields, day, at:fs.serverTimestamp()})
          .catch(err=>console.warn('기록을 올리지 못했어요',err));
        const le = local.find(x=>x.localId===localId); if(le) le.remoteId = ref.id;
      });
      write(LKEY,local); write(PKEY,[]);
      this.emit();
    },

    async init(){
      if(!FIREBASE_CONFIG){ this.failed = true; this.emit(); return; }
      try{
        const f = await loadFirebase();
        this.fb = f.fb; this.fs = f.fs; this.app = f.app; this.db = f.db;
        this.online = true;
        this.listen();
        this.flush();
        addEventListener('online',()=>this.flush());
        // 자정이 지나면 새 날짜의 랭킹으로 바꿔요
        let day = boothDay();
        setInterval(()=>{ if(boothDay()!==day){ day = boothDay(); this.listen(); } },60000);
      }catch(e){
        console.warn('Firebase를 불러오지 못해서 이 기기에만 저장해요',e);
        this.online = false; this.failed = true; this.emit();
      }
    },
    listen(){
      const fs = this.fs;
      if(this.unsub) this.unsub();
      this.unsub = fs.onSnapshot(fs.query(fs.collection(this.db,col),fs.where('day','==',boothDay())),snap=>{
        this.rows = snap.docs.map(d=>{ const v = d.data(); return {...v, id:d.id, remote:true, at:v.at && v.at.toMillis ? v.at.toMillis() : Date.now()}; });
        this.emit();
      },err=>{ console.warn('랭킹을 불러오지 못했어요',err); });
    },

    // ----- 선생님 관리 -----
    async login(){
      const auth = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`);
      const a = auth.getAuth(this.app);
      const res = await auth.signInWithPopup(a,new auth.GoogleAuthProvider());
      this.user = res.user; this.emit();
      return res.user;
    },
    async remove(row){
      if(row.remote){
        await this.fs.deleteDoc(this.fs.doc(this.db,col,row.id));
        write(LKEY,read(LKEY).filter(e=>e.remoteId!==row.id));
      }else{
        write(LKEY,read(LKEY).filter(e=>e.localId!==row.localId));
        write(PKEY,read(PKEY).filter(e=>e.localId!==row.localId));
      }
      this.emit();
    },
    async clearToday(){
      for(const r of this.today()) await this.remove(r);
    }
  };
  return B;
}
