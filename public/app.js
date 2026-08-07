const audio = document.querySelector('#audio');
const cd = document.querySelector('#cd');
const play = document.querySelector('#play');
const progress = document.querySelector('#progress');
const fileInput = document.querySelector('#fileInput');
const title = document.querySelector('#trackTitle');
const artist = document.querySelector('#trackArtist');
const current = document.querySelector('#currentTime');
const duration = document.querySelector('#duration');
const status = document.querySelector('#statusText');
const dropZone = document.querySelector('#dropZone');
let objectUrl;

const time = seconds => { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; };
const setProgress = () => { const value = audio.duration ? audio.currentTime / audio.duration * 100 : 0; progress.value = value; progress.style.setProperty('--played', `${value}%`); current.textContent = time(audio.currentTime); };
const setPlaying = isPlaying => { cd.classList.toggle('playing', isPlaying); document.body.classList.toggle('is-playing', isPlaying); play.classList.toggle('is-playing', isPlaying); play.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play'); status.textContent = isPlaying ? 'NOW SPINNING' : (audio.src ? 'PAUSED' : 'READY TO PLAY'); };
function loadTrack(file) {
  if (!file || !file.type.startsWith('audio/')) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file); audio.src = objectUrl;
  const name = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
  title.innerHTML = name.length > 26 ? `${name.slice(0, 26)}<br><em>${name.slice(26)}</em>` : `${name}<br><em>on compact disc.</em>`;
  artist.textContent = 'LOCAL AUDIO FILE'; progress.value = 0; progress.style.setProperty('--played', '0%');
  audio.play().catch(() => {});
}
play.addEventListener('click', () => { if (!audio.src) { fileInput.click(); return; } audio.paused ? audio.play() : audio.pause(); });
fileInput.addEventListener('change', e => loadTrack(e.target.files[0]));
audio.addEventListener('play', () => setPlaying(true)); audio.addEventListener('pause', () => setPlaying(false)); audio.addEventListener('ended', () => { setPlaying(false); audio.currentTime = 0; });
audio.addEventListener('timeupdate', setProgress); audio.addEventListener('loadedmetadata', () => { duration.textContent = time(audio.duration); setProgress(); });
progress.addEventListener('input', () => { if (audio.duration) audio.currentTime = progress.value / 100 * audio.duration; });
document.querySelector('#previous').addEventListener('click', () => audio.currentTime = Math.max(0, audio.currentTime - 10));
document.querySelector('#next').addEventListener('click', () => audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10));
['dragenter','dragover'].forEach(event => dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave','drop'].forEach(event => dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', e => loadTrack(e.dataTransfer.files[0]));
const modal = document.querySelector('#modal'); document.querySelector('#aboutButton').onclick = () => modal.classList.add('open'); document.querySelector('#closeModal').onclick = () => modal.classList.remove('open'); modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
