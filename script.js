let model;

const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const liveView = document.getElementById('liveView');
const enableWebcamButton = document.getElementById('webcamButton');
const stopWebcamButton = document.getElementById('stopWebcamButton');
const switchCameraButton = document.getElementById('switchCameraButton');
const refreshButton = document.getElementById('refreshButton');
const detectionConsole = document.getElementById('detectionConsole');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const resultMatrix = document.getElementById('resultMatrix');

let stream = null;
let currentFacingMode = 'user';
let isDetecting = false;

// デジタルなドラムサウンドのセットアップ
const kick = new Tone.MembraneSynth({
  pitchDecay: 0.01,
  octaves: 6,
  oscillator: { type: 'square' },
  envelope: {
    attack: 0.001,
    decay: 0.2,
    sustain: 0,
    release: 0.2
  }
}).toDestination();

const snare = new Tone.NoiseSynth({
  noise: { type: 'white' },
  envelope: {
    attack: 0.001,
    decay: 0.1,
    sustain: 0,
    release: 0.1
  }
}).toDestination();

const hihat = new Tone.MetalSynth({
  frequency: 200,
  envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
  harmonicity: 5.1,
  modulationIndex: 32,
  resonance: 4000,
  octaves: 1.5
}).toDestination();

const tom = new Tone.MembraneSynth({
  pitchDecay: 0.02,
  octaves: 4,
  oscillator: { type: 'triangle' },
  envelope: {
    attack: 0.001,
    decay: 0.1,
    sustain: 0,
    release: 0.1
  }
}).toDestination();

const drums = [kick, snare, hihat, tom];
const drumControls = ['kickControl', 'snareControl', 'hihatControl', 'tomControl'];

let currentDrumIndex = 0;
let lastDetectedObject = null;

// ドラムパラメーターノブ
const kickKnob = document.getElementById('kickKnob');
const snareKnob = document.getElementById('snareKnob');
const hihatKnob = document.getElementById('hihatKnob');
const tomKnob = document.getElementById('tomKnob');

function setupKnob(knob, minValue, maxValue, initialValue, updateFunction) {
  let isDragging = false;
  let startY;
  let startValue;

  knob.addEventListener('mousedown', startDragging);
  knob.addEventListener('touchstart', startDragging);
  document.addEventListener('mousemove', drag);
  document.addEventListener('touchmove', drag);
  document.addEventListener('mouseup', stop);
  document.addEventListener('touchend', stop);

  function startDragging(e) {
    isDragging = true;
    startY = e.clientY || e.touches[0].clientY;
    startValue = initialValue;
    e.preventDefault();
  }

  function drag(e) {
    if (!isDragging) return;
    const currentY = e.clientY || e.touches[0].clientY;
    const diff = startY - currentY;
    const newValue = Math.max(minValue, Math.min(maxValue, startValue + diff * (maxValue - minValue) / 100));
    updateFunction(newValue);
    knob.style.transform = `rotate(${(newValue - minValue) / (maxValue - minValue) * 270 - 135}deg)`;
  }

  function stop() {
    isDragging = false;
  }

  // 初期位置の設定
  knob.style.transform = `rotate(${(initialValue - minValue) / (maxValue - minValue) * 270 - 135}deg)`;
}

setupKnob(kickKnob, 20, 150, 40, (value) => { kick.pitch = value; });
setupKnob(snareKnob, 100, 500, 200, (value) => { snare.noise.type = value < 300 ? 'pink' : 'white'; });
setupKnob(hihatKnob, 2000, 10000, 6000, (value) => { hihat.frequency.value = value; });
setupKnob(tomKnob, 50, 200, 100, (value) => { tom.pitch = value; });

volumeSlider.addEventListener('input', function() {
  const volume = parseInt(this.value);
  volumeValue.textContent = `${volume} dB`;
  Tone.Destination.volume.value = volume;
});

// モデルの読み込み開始
cocoSsd.load().then(function (loadedModel) {
  model = loadedModel;
  enableWebcamButton.disabled = false;
}).catch(function(error) {
  console.error("Failed to load model:", error);
});

function hasGetUserMedia() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

if (hasGetUserMedia()) {
  enableWebcamButton.addEventListener('click', enableCam);
  stopWebcamButton.addEventListener('click', stopCam);
  switchCameraButton.addEventListener('click', switchCamera);
  refreshButton.addEventListener('click', refreshApp);
} else {
  console.warn('getUserMedia() is not supported by your browser');
  enableWebcamButton.disabled = true;
}

function enableCam(event) {
  if (!model) {
    console.log('Model not loaded yet, please wait.');
    return;
  }
  enableWebcamButton.classList.add('hidden');
  stopWebcamButton.classList.remove('hidden');
  switchCameraButton.classList.remove('hidden');
  refreshButton.classList.remove('hidden');
  startCamera();
}

function startCamera() {
  if (stream) {
    stopCameraStream();
  }
  const constraints = {
    video: { facingMode: currentFacingMode }
  };
  navigator.mediaDevices.getUserMedia(constraints)
    .then(function(s) {
      stream = s;
      video.srcObject = stream;
      video.onloadedmetadata = function() {
        video.play();
        updateCanvasSize();
        predictWebcam();
      };
      Tone.start();
    })
    .catch(function(error) {
      console.error("Error starting the camera: ", error);
    });
}

function stopCameraStream() {
  if (stream) {
    stream.getTracks().forEach(track => {
      track.stop();
    });
  }
  video.srcObject = null;
  stream = null;
}

function stopCam() {
  stopCameraStream();
  isDetecting = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  detectionConsole.innerHTML = '';
  resultMatrix.innerHTML = '';
  stopWebcamButton.classList.add('hidden');
  enableWebcamButton.classList.remove('hidden');
  switchCameraButton.classList.add('hidden');
  refreshButton.classList.add('hidden');
  // ドラムインジケーターのリセット
  updateDrumIndicator(-1);
}

function switchCamera() {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  startCamera();
}

function refreshApp() {
  stopCameraStream();
  startCamera();
}

function playDrum(detectedObject) {
  if (detectedObject !== lastDetectedObject) {
    currentDrumIndex = (currentDrumIndex + 1) % 4;
    lastDetectedObject = detectedObject;
  }
  updateDrumIndicator(currentDrumIndex);
  switch(currentDrumIndex) {
    case 0:
      kick.triggerAttackRelease(kick.pitch, "8n");
      break;
    case 1:
      snare.triggerAttackRelease("8n");
      break;
    case 2:
      hihat.triggerAttackRelease("32n");
      break;
    case 3:
      tom.triggerAttackRelease(tom.pitch, "8n");
      break;
  }
}

function updateDrumIndicator(activeIndex) {
  drumControls.forEach((controlId, index) => {
    const control = document.getElementById(controlId);
    if (index === activeIndex) {
      control.classList.add('active');
    } else {
      control.classList.remove('active');
    }
  });
}

function updateCanvasSize() {
  const containerWidth = liveView.offsetWidth;
  const containerHeight = liveView.offsetHeight;
  const videoAspectRatio = video.videoWidth / video.videoHeight;
  const containerAspectRatio = containerWidth / containerHeight;
  let canvasWidth, canvasHeight;
  if (containerAspectRatio > videoAspectRatio) {
    canvasHeight = containerHeight;
    canvasWidth = canvasHeight * videoAspectRatio;
  } else {
    canvasWidth = containerWidth;
    canvasHeight = canvasWidth / videoAspectRatio;
  }
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  canvas.style.left = `${(containerWidth - canvasWidth) / 2}px`;
  canvas.style.top = `${(containerHeight - canvasHeight) / 2}px`;
}

function predictWebcam() {
  if (!stream) return; // ストリームがない場合は処理を停止
  model.detect(video).then(function (predictions) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let detectedObjects = [];
    const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const offsetX = (canvas.width - video.videoWidth * scale) / 2;
    const offsetY = (canvas.height - video.videoHeight * scale) / 2;
    ctx.strokeStyle = '#FF5733';
    ctx.lineWidth = 4;
    ctx.fillStyle = '#FF5733';
    ctx.font = '18px Inter';
    for (let n = 0; n < predictions.length; n++) {
      if (predictions[n].score > 0.66) {
        const [x, y, width, height] = predictions[n].bbox;
        const scaledX = x * scale + offsetX;
        const scaledY = y * scale + offsetY;
        const scaledWidth = width * scale;
        const scaledHeight = height * scale;
        ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);
        ctx.fillText(`${predictions[n].class} - ${Math.round(predictions[n].score * 100)}%`, scaledX, scaledY > 10 ? scaledY - 5 : 10);
        updateResultMatrix(predictions[n].class, predictions[n].score);
        addToConsole(predictions[n].class, predictions[n].score);
        detectedObjects.push(predictions[n].class);
      }
    }
    if (detectedObjects.length > 0) {
      playDrum(detectedObjects[0]); // 最初に検出されたオブジェクトに対してドラムを再生
    } else {
      updateDrumIndicator(-1); // オブジェクトが検出されなかった場合
    }
    // 次のフレームの検出をリクエスト
    requestAnimationFrame(predictWebcam);
  });
}

function updateResultMatrix(className, score) {
  let existingItem = document.querySelector(`.result-item[data-class="${className}"]`);
  if (existingItem) {
    existingItem.textContent = `${className}: ${Math.round(score * 100)}%`;
    existingItem.classList.add('active');
    setTimeout(() => existingItem.classList.remove('active'), 300);
  } else {
    const newItem = document.createElement('div');
    newItem.className = 'result-item active';
    newItem.setAttribute('data-class', className);
    newItem.textContent = `${className}: ${Math.round(score * 100)}%`;
    resultMatrix.appendChild(newItem);
    setTimeout(() => newItem.classList.remove('active'), 300);
  }
}

function addToConsole(className, score) {
  const consoleItem = document.createElement('div');
  consoleItem.className = 'console-item';
  consoleItem.textContent = `${className} - ${Math.round(score * 100)}%`;
  detectionConsole.insertBefore(consoleItem, detectionConsole.firstChild);
  while (detectionConsole.children.length > 5) {
    detectionConsole.removeChild(detectionConsole.lastChild);
  }
}

// ページ読み込み時にTone.jsを初期化
document.addEventListener('DOMContentLoaded', function() {
  Tone.start();
  console.log('Tone.js initialized');
});

// ウィンドウリサイズ時にキャンバスサイズを調整
window.addEventListener('resize', updateCanvasSize);