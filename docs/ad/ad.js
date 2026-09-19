const $ = selector => document.querySelector(selector);
const film = $('.film');
const canvas = $('#scene');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const duration = 24;
const params = new URLSearchParams(location.search);
const capture = params.has('capture');
film.classList.toggle('capture', capture);
const chapters = [
  { kicker: '01 / THE SPARK', title: ['Big ideas.', 'Meet Flash.'], description: ['A spark of intelligence.', 'A whole new world of possibility.'], tags: ['FAST BY DEFAULT', 'NATIVE VISION'] },
  { kicker: '02 / A NEW PERSPECTIVE', title: ['Show it.', 'See more.'], description: ['Paste a screenshot. Ask your question.', 'Native vision. Built into Flash.'], tags: ['IMAGES INTO INSIGHT', 'NATIVE MULTIMODAL INPUT'] },
  { kicker: '03 / ROOM TO THINK', title: ['Go deeper.', 'By choice.'], description: ['Quick when you need it.', 'Extra reasoning when you ask for it.'], tags: ['FAST PASS BY DEFAULT', 'OPT-IN REASONING'] },
  { kicker: '04 / YOUR NEXT MOVE', title: ['Less friction.', 'More creation.'], description: ['Meet your next idea in the terminal.', 'Make something worth bringing to life.'], tags: ['AXON CLI', 'LINUX / WINDOWS / MACOS'] },
];
let time = 0, playing = !reduced.matches, last = performance.now(), chapter = -1, dirty = true;
let dragging = false, dragX = 0, dragY = 0, pointer = [0, 0], previousPointer = [0, 0];
let audio, audioNodes = [], soundOn = false;
let gl, program, locations;
const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision highp float;
uniform vec2 resolution;
uniform float time;
uniform vec2 pointer;
uniform float phase;
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float torus(vec3 p,vec2 t){return length(vec2(length(p.xz)-t.x,p.y))-t.y;}
float shape(vec3 p){
 p.xz=rot(time*.17+pointer.x)*p.xz;
 p.xy=rot(.34+pointer.y)*p.xy;
 float twist=.26*sin(time*.32);
 vec3 q=p;q.yz=rot(.7+twist)*q.yz;
 float a=torus(q,vec2(1.17,.195));
 q=p;q.xy=rot(1.1+phase*.22)*q.xy;q.yz=rot(-.65)*q.yz;
 float b=torus(q,vec2(.92,.175));
 q=p;q.xy=rot(-.8)*q.xy;q.yz=rot(1.4+time*.12)*q.yz;
 float c=torus(q,vec2(.65,.14));
 return min(min(a,b),c);
}
vec3 normal(vec3 p){vec2 e=vec2(.002,0.);return normalize(vec3(shape(p+e.xyy)-shape(p-e.xyy),shape(p+e.yxy)-shape(p-e.yxy),shape(p+e.yyx)-shape(p-e.yyx)));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 uv.x-=resolution.x/resolution.y>1.2?.15:0.;
 uv*=resolution.x/resolution.y<1.2?1.25:1.;
 vec3 ro=vec3(0.,.12,4.8),rd=normalize(vec3(uv*2.65,-4.4));
 vec3 col=vec3(.043,.055,.071);
 float radial=exp(-length(uv)*2.8);col+=vec3(.025,.032,.035)*radial;
 float angle=atan(uv.y,uv.x),radius=length(uv);
 float ring=exp(-abs(radius-.68)*600.)*.075+exp(-abs(radius-.79)*600.)*.035;
 col+=vec3(.55,.67,.73)*ring;
 float d=0.,hit=0.;vec3 p;
 for(int i=0;i<76;i++){p=ro+rd*d;float h=shape(p);if(h<.002){hit=1.;break;} d+=h*.82;if(d>8.)break;}
 if(hit>.5){
  vec3 n=normal(p),view=normalize(ro-p),light=normalize(vec3(-3.,5.,4.));
  float diff=max(dot(n,light),0.);
  float spec=pow(max(dot(reflect(-light,n),view),0.),42.);
  float rim=pow(1.-max(dot(n,view),0.),2.);
  vec3 copper=mix(vec3(.24,.053,.019),vec3(1.,.43,.16),diff);
  float band=sin(p.y*33.+p.x*12.)*.015;
  col=copper*(.35+diff*.95)+vec3(1.,.88,.71)*spec*.95;
  col+=vec3(1.,.43,.14)*rim*.48+band;
  vec3 reflected=reflect(rd,n);col+=vec3(.16,.23,.28)*pow(max(reflected.y,0.),3.);
 }
 float core=exp(-length(uv-vec2(0.,.01))*22.);
 if(hit<.5) col+=vec3(1.,.46,.17)*core*1.3;
 col+=vec3(1.,.26,.07)*exp(-length(uv)*5.)*.035;
 vec2 cell=floor((uv+vec2(time*.001,0.))*150.);
 float star=step(.995,hash(cell))*pow(max(0.,1.-length(fract((uv+vec2(time*.001,0.))*150.)-.5)*2.),5.);
 col+=star*vec3(.3,.32,.36)*smoothstep(.3,1.,radius);
 col+=(hash(gl_FragCoord.xy)-.5)*.012;
 gl_FragColor=vec4(col,1.);
}`;
function initGL() {
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL unavailable');
    const shader = (type, source) => {
      const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
      return value;
    };
    program = gl.createProgram(); gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed');
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    locations = Object.fromEntries(['resolution', 'time', 'pointer', 'phase'].map(name => [name, gl.getUniformLocation(program, name)]));
    film.classList.remove('no-webgl'); $('#render-label').textContent = 'REAL-TIME 3D';
  } catch {
    gl = null; film.classList.add('no-webgl'); $('#render-label').textContent = 'CSS 3D EDITION';
  }
  dirty = true;
}
function resize() {
  // A capped render resolution keeps the ray-marched film comfortable on laptops.
  const ratio = capture ? 1 : Math.min(devicePixelRatio || 1, 1.25);
  canvas.width = Math.max(1, Math.min(capture ? 1920 : 1200, Math.round(canvas.clientWidth * ratio)));
  canvas.height = Math.max(1, Math.min(capture ? 1080 : 1000, Math.round(canvas.clientHeight * ratio)));
  dirty = true;
}
function setChapter(index) {
  if (index === chapter) return;
  chapter = index;
  film.dataset.chapter = String(index);
  const data = chapters[index];
  $('#kicker').textContent = data.kicker;
  $('#headline').replaceChildren(document.createTextNode(data.title[0]), document.createElement('br'), Object.assign(document.createElement('span'), { textContent: data.title[1] }));
  $('#description').replaceChildren(document.createTextNode(data.description[0]), document.createElement('br'), document.createTextNode(data.description[1]));
  $('#feature-tags').replaceChildren(...data.tags.map(text => Object.assign(document.createElement('span'), { textContent: text })));
  document.querySelectorAll('button[data-chapter]').forEach(button => {
    const active = Number(button.dataset.chapter) === index; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
  });
  if (!reduced.matches && !capture) $('#chapter-copy').animate([{ opacity: .15, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 450, easing: 'ease-out' });
}
function update() {
  setChapter(Math.min(3, Math.floor(time / 6)));
  $('#elapsed').textContent = `00:${String(Math.floor(time)).padStart(2, '0')}`;
  $('#timeline').value = String(time);
  $('#timeline').style.setProperty('--progress', `${time / duration * 100}%`);
  $('#timeline').setAttribute('aria-valuetext', `${time.toFixed(1)} seconds of 24`);
  $('#play').setAttribute('aria-label', playing ? 'Pause film' : time >= duration ? 'Replay film' : 'Play film');
  $('#play-icon').textContent = playing ? 'Ⅱ' : '▶';
  film.classList.toggle('paused', !playing);
  syncAudio();
}
function seek(value) { time = Math.max(0, Math.min(duration, Number.isFinite(value) ? value : 0)); dirty = true; update(); }
function setPlaying(value) {
  if (value && time >= duration) seek(0);
  playing = value; last = performance.now(); update();
}
function syncAudio() {
  if (!audio) return;
  const enabled = soundOn && playing && !document.hidden;
  audioNodes.forEach(({ gain, base }, index) => {
    gain.gain.setTargetAtTime(enabled ? base * (1 + chapter * .08) : 0, audio.currentTime, .3);
  });
}
async function toggleSound() {
  try {
    if (!audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audio = new AudioContext();
      const master = audio.createGain(); master.gain.value = .22; master.connect(audio.destination);
      [110,164.81,220,329.63].forEach((frequency, index) => {
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.value = 0;
        oscillator.connect(gain); gain.connect(master); oscillator.start(); audioNodes.push({ gain, base: index === 0 ? .2 : .07 });
      });
    }
    await audio.resume(); soundOn = !soundOn;
    $('#sound').textContent = soundOn ? 'SOUND ON' : 'SOUND OFF'; $('#sound').setAttribute('aria-pressed', String(soundOn)); syncAudio();
  } catch { $('#sound').textContent = 'SOUND UNAVAILABLE'; $('#sound').disabled = true; }
}
$('#play').addEventListener('click', () => setPlaying(!playing));
$('#replay').addEventListener('click', () => { seek(0); setPlaying(true); });
$('#sound').addEventListener('click', toggleSound);
$('#timeline').addEventListener('input', event => { const value = Number(event.target.value); setPlaying(false); seek(value); });
document.querySelectorAll('button[data-chapter]').forEach(button => button.addEventListener('click', () => seek(Number(button.dataset.chapter) * 6)));
window.addEventListener('keydown', event => {
  if (event.code === 'Space' && !['INPUT', 'BUTTON', 'A'].includes(document.activeElement.tagName)) { event.preventDefault(); setPlaying(!playing); }
});
const visual = $('.visual');
visual.addEventListener('pointerdown', event => { dragging = true; previousPointer = [event.clientX,event.clientY]; visual.setPointerCapture(event.pointerId); });
visual.addEventListener('pointermove', event => {
  if (!dragging) return;
  dragX += (event.clientX-previousPointer[0])*.008; dragY += (event.clientY-previousPointer[1])*.006;
  pointer = [dragX, Math.max(-1,Math.min(1,dragY))]; previousPointer=[event.clientX,event.clientY]; dirty=true;
});
visual.addEventListener('pointerup', () => { dragging = false; });
visual.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); gl=null; film.classList.add('no-webgl'); $('#render-label').textContent='CSS 3D EDITION'; });
canvas.addEventListener('webglcontextrestored', () => { initGL(); resize(); });
reduced.addEventListener('change', () => { if(reduced.matches) setPlaying(false); });
document.addEventListener('visibilitychange', () => { last=performance.now(); syncAudio(); });
window.addEventListener('resize', resize);
function render() {
  if (!gl) return;
  gl.viewport(0,0,canvas.width,canvas.height); gl.uniform2f(locations.resolution,canvas.width,canvas.height);
  gl.uniform1f(locations.time,time); gl.uniform2f(locations.pointer,...pointer); gl.uniform1f(locations.phase,Math.min(3,time/6));
  gl.drawArrays(gl.TRIANGLES,0,6); dirty=false;
}
// Read-only state + an explicit deterministic capture API for local exports/tests.
window.axonFilm = Object.freeze({
  seek(value) { setPlaying(false); seek(value); render(); },
  get state() { return { time, playing, chapter, soundOn, webgl: Boolean(gl), duration }; }
});
let previousRender=0;
function frame(now) {
  const delta=Math.max(0,Math.min((now-last)/1000,.1));last=now;
  if (!document.hidden) {
    if (playing) { time=Math.min(duration,time+delta); if(time>=duration) playing=false; dirty=true; update(); }
    if (gl && dirty && now-previousRender>32) {
      render(); previousRender=now;
    }
  }
  requestAnimationFrame(frame);
}
initGL(); resize(); update(); requestAnimationFrame(frame);
// Deterministic preview links: ?t=12&paused=1. No data leaves the page.

if(params.has('t')) seek(Number(params.get('t')) || 0);
if(params.has('paused') || capture) setPlaying(false);
render();
