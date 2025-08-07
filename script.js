// --- Imports (if using modules/bundler) ---
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SAOPass } from 'three/examples/jsm/postprocessing/SAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

let scene, camera, renderer, composer, controls;
const loaderGLTF = new THREE.GLTFLoader();
const draco = new THREE.DRACOLoader();
const raycaster = new THREE.Raycaster();
draco.setDecoderPath('js/libs/draco/');
loaderGLTF.setDRACOLoader(draco);

const zombies    = [];
const pickups    = [];
const clock      = new THREE.Clock();

// Player State
let wave      = 1;
let waveTimer = 10;
let ammo      = 30;
let magSize   = 30;
let health    = 100;
let reloading = false;
let sprinting = false;
let canJump   = true;

// DOM References
const overlay    = document.getElementById('overlay');
const startBtn   = document.getElementById('startBtn');
const waveInfo   = document.getElementById('waveInfo');
const ammoCount  = document.getElementById('ammoCount');
const magElem    = document.getElementById('magSize');
const reloadPr   = document.getElementById('reloadPrompt');
const healthBar  = document.getElementById('healthBar');
const powerUpMsg = document.getElementById('powerUpMsg');



// Start the Game
startBtn.addEventListener('click', () => {
  init();
  animate();
  controls.lock();
  overlay.style.display = 'none';
});

// Initialization
function init() {
  // Scene & Camera
  scene = new THREE.Scene();
  scene.background = new THREE.CubeTextureLoader()
    .setPath('skybox/')
    .load(['px.jpg','nx.jpg','py.jpg','ny.jpg','pz.jpg','nz.jpg']);
  scene.fog = new THREE.FogExp2(0x222222, 0.02);

  camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 500);
  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Renderer (transparent to show CSS sky)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Lights
  const hemi = new THREE.HemisphereLight(0x8888ff, 0x222222, 0.6);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5,10,7);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048,2048);
  scene.add(dir);

    // PointerLockControls
  controls = new THREE.PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());
  document.addEventListener('click', onShoot);


  // Floor
  const texLoader = new THREE.TextureLoader();
  const floorMat = new THREE.MeshStandardMaterial({
    map: texLoader.load('textures/asphalt_diff.jpg'),
    normalMap: texLoader.load('textures/asphalt_nrm.jpg')
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(300,300), floorMat);
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Placeholder buildings
  spawnBuildings(100);

  // Placeholder zombies
  spawnZombies(10);

  window.addEventListener('resize', onResize);
  function spawnBuildings(count) {
  const colors = [0x888888, 0x444444, 0x666633, 0x333366];
  for (let i = 0; i < count; i++) {
    const w = 5 + Math.random() * 10;
    const h = 10 + Math.random() * 40;
    const d = 5 + Math.random() * 10;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: colors[Math.floor(Math.random() * colors.length)],
    });
    const b = new THREE.Mesh(geo, mat);
    b.position.set(
      (Math.random() - 0.5) * 400,
      h / 2,
      (Math.random() - 0.5) * 400
    );
    scene.add(b);
  }
}

  // Post-Processing
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  composer.addPass(new THREE.UnrealBloomPass(
    new THREE.Vector2(innerWidth,innerHeight), 1.0, 0.3, 0.8
  ));
  composer.addPass(new THREE.SAOPass(scene, camera, false, true));
  const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
  fxaa.uniforms['resolution'].value.set(1/innerWidth, 1/innerHeight);
  composer.addPass(fxaa);

  // Controls & Input
  controls = new THREE.PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('click', shoot);
  window.addEventListener('resize', onWindowResize);

  // HUD Initialization
  magElem.textContent = magSize;
  ammoCount.textContent = ammo;

  // Wave & Pickups
  spawnWave();
  setInterval(waveCountdown, 1000);
}

// Wave System
function waveCountdown() {
  if (zombies.length === 0 && waveTimer <= 0) {
    wave++; waveTimer = 10; spawnWave();
  } else if (zombies.length === 0) {
    waveTimer--;
  }
  waveInfo.textContent = `Wave ${wave} in ${waveTimer}s`;
}

function spawnWave() {
  const count = wave * 5 + (wave % 5 === 0 ? 10 : 0);
  for (let i = 0; i < count; i++) spawnZombie();
  if (wave % 5 === 0) spawnZombie(true);
}

// Zombie Spawner
function spawnZombie(isBoss=false) {
  loaderGLTF.load('models/zombie.glb', gltf => {
    const z = gltf.scene.clone();
    const r = 30 + Math.random() * 40;
    const a = Math.random() * Math.PI * 2;
    z.position.set(Math.cos(a)*r, 0, Math.sin(a)*r);
    const scale = isBoss ? 3 : 1.5;
    z.scale.set(scale, scale, scale);
    z.traverse(m => m.castShadow = true);
    z.userData = {
      health: isBoss ? 10 : 3,
      speed: isBoss ? 1.5 : 1
    };
    scene.add(z);
    zombies.push(z);
  });
}

// Shoot & Reload
function shoot() {
  if (reloading || ammo <= 0) return;
  ammo--; ammoCount.textContent = ammo;
  if (ammo === 0) reloadPr.style.display = 'inline';

  const ray = new THREE.Raycaster();
  ray.setFromCamera({ x:0, y:0 }, camera);
  const hits = ray.intersectObjects(zombies, true);
  if (hits.length) {
    const z = hits[0].object.parent;
    z.userData.health--;
    if (z.userData.health <= 0) {
      scene.remove(z);
      zombies.splice(zombies.indexOf(z), 1);
    }
  }
  muzzleFlash();
}

function startReload() {
  reloading = true;
  reloadPr.textContent = 'Reloading...';
  setTimeout(() => {
    ammo = magSize;
    ammoCount.textContent = ammo;
    reloading = false;
    reloadPr.style.display = 'none';
    reloadPr.textContent = '[R] to Reload';
  }, 1500);
}

// Muzzle Flash Effect
function muzzleFlash() {
  const flash = new THREE.PointLight(0xffddaa, 2, 10, 2);
  flash.position.copy(camera.position);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 50);
}

// Movement & Pickups
function onKeyDown(e) {
  if (e.code === 'KeyR' && ammo < magSize && !reloading) startReload();
  if (e.code === 'ShiftLeft') sprinting = true;
  if (e.code === 'Space' && canJump) {
    controls.getObject().position.y += 5;
    canJump = false;
  }
}
function onKeyUp(e) {
  if (e.code === 'ShiftLeft') sprinting = false;
}

function spawnPickup(type) {
  const geo = new THREE.BoxGeometry(1,1,1);
  const mat = new THREE.MeshStandardMaterial({
    color: type === 'ammo' ? 0x00aaff : 0xff0000
  });
  const p = new THREE.Mesh(geo, mat);
  p.position.set(
    (Math.random()-0.5) * 100,
    0.5,
    (Math.random()-0.5) * 100
  );
  p.userData = { type };
  scene.add(p);
  pickups.push(p);
}

function checkPickups() {
  pickups.forEach((p,i) => {
    if (p.position.distanceTo(camera.position) < 2) {
      if (p.userData.type === 'ammo') {
        ammo = Math.min(magSize, ammo + 15);
        ammoCount.textContent = ammo;
      } else {
        health = Math.min(100, health + 25);
        healthBar.style.width = `${health * 2.5}px`;
      }
      scene.remove(p);
      pickups.splice(i,1);
      powerUpMsg.textContent = `${p.userData.type.toUpperCase()} PICKED UP!`;
      setTimeout(() => powerUpMsg.textContent = '', 2000);
    }
  });
}

// Main Loop
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  // Player Movement
  const speed = sprinting ? 10 : 5;
  controls.moveForward(speed * dt);

  // Zombie Logic
  zombies.forEach(z => {
    const dir = camera.position.clone().sub(z.position).setY(0).normalize();
    z.position.addScaledVector(dir, z.userData.speed * dt);
    if (z.position.distanceTo(camera.position) < 1.5) {
      health = Math.max(0, health - dt * 10);
      healthBar.style.width = `${health * 2.5}px`;
      if (health === 0) gameOver();
    }
  });

  // Random Pickups
  if (Math.random() < 0.002) spawnPickup('ammo');
  if (Math.random() < 0.001) spawnPickup('health');
  checkPickups();

  // Ensure pointer-lock movement updates
  controls.moveForward(0);

  // Render with post-processing
  composer.render();
}

// Handle Game Over
function gameOver() {
  alert(`You died at wave ${wave}`);
  window.location.reload();
}

// Window Resize
function onWindowResize() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}
