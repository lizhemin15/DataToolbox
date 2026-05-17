// OrbitControls IIFE wrapper for three@0.160.0
// Converts ES module to THREE.OrbitControls global
(function() {
  if (typeof THREE === 'undefined') return;
  // Inline OrbitControls implementation adapted for IIFE
  const {
    EventDispatcher,
    MOUSE,
    Quaternion,
    Spherical,
    TOUCH,
    Vector2,
    Vector3,
    Plane,
    Ray
  } = THREE;

  const _changeEvent = { type: 'change' };
  const _startEvent = { type: 'start' };
  const _endEvent = { type: 'end' };
  const _ray = new Ray();
  const _plane = new Plane();
  const _intersection = new Vector3();
  const _spherical = new Spherical();
  const _quaternion = new Quaternion();
  const _offset = new Vector3();
  const _twoPI = 2 * Math.PI;
  const _v = new Vector3();

  class OrbitControls extends EventDispatcher {
    constructor(object, domElement) {
      super();
      this.object = object;
      this.domElement = domElement;
      this.domElement.style.touchAction = 'none';
      this.enabled = true;
      this.target = new Vector3();
      this.minDistance = 0;
      this.maxDistance = Infinity;
      this.minZoom = 0;
      this.maxZoom = Infinity;
      this.minPolarAngle = 0;
      this.maxPolarAngle = Math.PI;
      this.minAzimuthAngle = -Infinity;
      this.maxAzimuthAngle = Infinity;
      this.enableDamping = false;
      this.dampingFactor = 0.05;
      this.enableZoom = true;
      this.zoomSpeed = 1.0;
      this.enableRotate = true;
      this.rotateSpeed = 1.0;
      this.enablePan = true;
      this.panSpeed = 1.0;
      this.screenSpacePanning = true;
      this.keyPanSpeed = 7.0;
      this.autoRotate = false;
      this.autoRotateSpeed = 2.0;
      this.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
      this.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
      this.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
      this.target0 = this.target.clone();
      this.position0 = this.object.position.clone();
      this.zoom0 = this.object.zoom;
      this._domElementKeyEvents = null;
      this.getPolarAngle = function() { return _spherical.phi; };
      this.getAzimuthalAngle = function() { return _spherical.theta; };
      this.getDistance = function() { return this.object.position.distanceTo(this.target); };
      this.listenToKeyEvents = function(domElement) { domElement.addEventListener('keydown', onKeyDown); this._domElementKeyEvents = domElement; };
      this.saveState = function() { this.target0.copy(this.target); this.position0.copy(this.object.position); this.zoom0 = this.object.zoom; };
      this.reset = function() { this.target.copy(this.target0); this.object.position.copy(this.position0); this.object.zoom = this.zoom0; this.object.updateProjectionMatrix(); this.dispatchEvent(_changeEvent); this.update(); };
      this.update = (function() {
        const offset = new Vector3();
        const lastPosition = new Vector3();
        const lastQuaternion = new Quaternion();
        const lastTargetPosition = new Vector3();
        let scale = 1;
        return function update() {
          const position = this.object.position;
          offset.copy(position).sub(this.target);
          offset.applyQuaternion(this.object.quaternion);
          _spherical.setFromVector3(offset);
          if (this.autoRotate && this.enabled) { const angle = 2 * Math.PI / 60 / 60 * this.autoRotateSpeed; _spherical.theta -= angle; }
          if (this.enableDamping) { _spherical.theta += _sphericalDelta.theta * this.dampingFactor; _spherical.phi += _sphericalDelta.phi * this.dampingFactor; } else { _spherical.theta += _sphericalDelta.theta; _spherical.phi += _sphericalDelta.phi; }
          _spherical.theta = Math.max(this.minAzimuthAngle, Math.min(this.maxAzimuthAngle, _spherical.theta));
          _spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, _spherical.phi));
          _spherical.makeSafe();
          _spherical.radius *= scale;
          _spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, _spherical.radius));
          if (this.enableDamping) { this.target.addScaledVector(_panOffset, this.dampingFactor); } else { this.target.add(_panOffset); }
          offset.setFromSpherical(_spherical);
          offset.applyQuaternion(_quaternion.copy(this.object.quaternion).invert());
          position.copy(this.target).add(offset);
          this.object.lookAt(this.target);
          if (this.enableDamping) { _sphericalDelta.theta *= (1 - this.dampingFactor); _sphericalDelta.phi *= (1 - this.dampingFactor); _panOffset.multiplyScalar(1 - this.dampingFactor); } else { _sphericalDelta.set(0, 0, 0); _panOffset.set(0, 0, 0); }
          scale = 1;
          if (lastPosition.distanceToSquared(this.object.position) > 0 || lastQuaternion.angleTo(this.object.quaternion) > 0 || lastTargetPosition.distanceToSquared(this.target) > 0) {
            this.dispatchEvent(_changeEvent);
            lastPosition.copy(this.object.position);
            lastQuaternion.copy(this.object.quaternion);
            lastTargetPosition.copy(this.target);
            return true;
          }
          return false;
        };
      })();
      const _sphericalDelta = new Spherical();
      const _panOffset = new Vector3();
      let rotateStart = new Vector2();
      let rotateEnd = new Vector2();
      const rotateDelta = new Vector2();
      let panStart = new Vector2();
      let panEnd = new Vector2();
      const panDelta = new Vector2();
      let dollyStart = new Vector2();
      let dollyEnd = new Vector2();
      const dollyDelta = new Vector2();
      const pointers = [];
      let pointerPositions = {};
      const self = this;
      function onPointerDown(event) { if (self.enabled === false) return; if (pointers.length === 0) { self.domElement.setPointerCapture(event.pointerId); self.domElement.addEventListener('pointermove', onPointerMove); self.domElement.addEventListener('pointerup', onPointerUp); } addPointer(event); if (event.pointerType === 'touch') { onTouchStart(event); } else { onMouseDown(event); } }
      function onPointerMove(event) { if (self.enabled === false) return; if (event.pointerType === 'touch') { onTouchMove(event); } else { onMouseMove(event); } }
      function onPointerUp(event) { removePointer(event); if (pointers.length === 0) { self.domElement.releasePointerCapture(event.pointerId); self.domElement.removeEventListener('pointermove', onPointerMove); self.domElement.removeEventListener('pointerup', onPointerUp); } if (event.pointerType === 'touch') { onTouchEnd(); } else { onMouseUp(); } }
      function addPointer(event) { pointers.push(event); }
      function removePointer(event) { delete pointerPositions[event.pointerId]; for (let i = 0; i < pointers.length; i++) { if (pointers[i].pointerId === event.pointerId) { pointers.splice(i, 1); return; } } }
      function trackPointer(event) { pointerPositions[event.pointerId] = new Vector2(event.clientX, event.clientY); }
      function getSecondPointerPosition(event) { const pointer = (event.pointerId === pointers[0].pointerId) ? pointers[1] : pointers[0]; return pointerPositions[pointer.pointerId]; }
      this.domElement.addEventListener('pointerdown', onPointerDown);
      function onMouseDown(event) { let mouseAction; switch (event.button) { case 0: mouseAction = self.mouseButtons.LEFT; break; case 1: mouseAction = self.mouseButtons.MIDDLE; break; case 2: mouseAction = self.mouseButtons.RIGHT; break; default: mouseAction = -1; } switch (mouseAction) { case MOUSE.DOLLY: handleMouseDownDolly(event); break; case MOUSE.ROTATE: handleMouseDownRotate(event); break; case MOUSE.PAN: handleMouseDownPan(event); break; default: break; } }
      function onMouseMove(event) { switch (state) { case STATE.ROTATE: handleMouseMoveRotate(event); break; case STATE.DOLLY: handleMouseMoveDolly(event); break; case STATE.PAN: handleMouseMovePan(event); break; default: break; } }
      function onMouseUp() { state = STATE.NONE; }
      function handleMouseDownRotate(event) { rotateStart.set(event.clientX, event.clientY); state = STATE.ROTATE; }
      function handleMouseDownDolly(event) { dollyStart.set(event.clientX, event.clientY); state = STATE.DOLLY; }
      function handleMouseDownPan(event) { panStart.set(event.clientX, event.clientY); state = STATE.PAN; }
      function handleMouseMoveRotate(event) { rotateEnd.set(event.clientX, event.clientY); rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(self.rotateSpeed); const el = self.domElement; _sphericalDelta.theta -= 2 * Math.PI * rotateDelta.x / el.clientHeight; _sphericalDelta.phi -= 2 * Math.PI * rotateDelta.y / el.clientHeight; rotateStart.copy(rotateEnd); self.update(); }
      function handleMouseMoveDolly(event) { dollyEnd.set(event.clientX, event.clientY); dollyDelta.subVectors(dollyEnd, dollyStart); if (dollyDelta.y > 0) { scale /= Math.pow(0.95, self.zoomSpeed); } else if (dollyDelta.y < 0) { scale *= Math.pow(0.95, self.zoomSpeed); } dollyStart.copy(dollyEnd); self.update(); }
      function handleMouseMovePan(event) { panEnd.set(event.clientX, event.clientY); panDelta.subVectors(panEnd, panStart).multiplyScalar(self.panSpeed); pan(panDelta.x, panDelta.y); panStart.copy(panEnd); self.update(); }
      function onTouchStart(event) { trackPointer(event); switch (pointers.length) { case 1: switch (self.touches.ONE) { case TOUCH.ROTATE: handleTouchStartRotate(event); break; case TOUCH.PAN: handleTouchStartPan(event); break; default: state = STATE.NONE; } break; case 2: switch (self.touches.TWO) { case TOUCH.DOLLY_PAN: handleTouchStartDollyPan(event); break; case TOUCH.DOLLY_ROTATE: handleTouchStartDollyRotate(event); break; default: state = STATE.NONE; } break; default: state = STATE.NONE; } }
      function onTouchMove(event) { trackPointer(event); switch (state) { case STATE.ROTATE: handleTouchMoveRotate(event); break; case STATE.DOLLY_PAN: handleTouchMoveDollyPan(event); break; case STATE.DOLLY_ROTATE: handleTouchMoveDollyRotate(event); break; case STATE.PAN: handleTouchMovePan(event); break; default: break; } }
      function onTouchEnd() { state = STATE.NONE; }
      function handleTouchStartRotate(event) { if (pointers.length === 1) { rotateStart.set(event.clientX, event.clientY); } else { const position = getSecondPointerPosition(event); const x = (event.clientX + position.x) / 2; const y = (event.clientY + position.y) / 2; rotateStart.set(x, y); } state = STATE.ROTATE; }
      function handleTouchStartPan(event) { panStart.set(event.clientX, event.clientY); state = STATE.PAN; }
      function handleTouchStartDollyPan(event) { if (self.enableZoom) handleMouseDownDolly(event); if (self.enablePan) handleMouseDownPan(event); }
      function handleTouchStartDollyRotate(event) { if (self.enableZoom) handleMouseDownDolly(event); if (self.enableRotate) handleTouchStartRotate(event); }
      function handleTouchMoveRotate(event) { if (pointers.length === 1) { rotateEnd.set(event.clientX, event.clientY); } else { const position = getSecondPointerPosition(event); const x = (event.clientX + position.x) / 2; const y = (event.clientY + position.y) / 2; rotateEnd.set(x, y); } rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(self.rotateSpeed); const el = self.domElement; _sphericalDelta.theta -= 2 * Math.PI * rotateDelta.x / el.clientHeight; _sphericalDelta.phi -= 2 * Math.PI * rotateDelta.y / el.clientHeight; rotateStart.copy(rotateEnd); self.update(); }
      function handleTouchMovePan(event) { panEnd.set(event.clientX, event.clientY); panDelta.subVectors(panEnd, panStart).multiplyScalar(self.panSpeed); pan(panDelta.x, panDelta.y); panStart.copy(panEnd); self.update(); }
      function handleTouchMoveDollyPan(event) { if (self.enableZoom) handleMouseMoveDolly(event); if (self.enablePan) handleMouseMovePan(event); }
      function handleTouchMoveDollyRotate(event) { if (self.enableZoom) handleMouseMoveDolly(event); if (self.enableRotate) handleTouchMoveRotate(event); }
      function pan(deltaX, deltaY) { const el = self.domElement; if (self.object.isPerspectiveCamera) { const position = self.object.position; _offset.copy(position).sub(self.target); let targetDistance = _offset.length(); targetDistance *= Math.tan((self.object.fov / 2) * Math.PI / 180.0); targetDistance = Math.max(targetDistance, 0.001); const newPanOffset = new Vector3(); if (self.screenSpacePanning === true) { _v.setFromMatrixColumn(self.object.matrix, 0); newPanOffset.copy(_v).multiplyScalar(-2 * deltaX * targetDistance / el.clientHeight); _v.setFromMatrixColumn(self.object.matrix, 1); newPanOffset.addScaledVector(_v, 2 * deltaY * targetDistance / el.clientHeight); } else { _v.setFromMatrixColumn(self.object.matrix, 0); newPanOffset.copy(_v).multiplyScalar(-2 * deltaX * targetDistance / el.clientHeight); _v.setFromMatrixColumn(self.object.matrix, 1); _v.y = 0; newPanOffset.addScaledVector(_v, 2 * deltaY * targetDistance / el.clientHeight); } _panOffset.add(newPanOffset); } else if (self.object.isOrthographicCamera) { const zoom = self.object.zoom; const newPanOffset = new Vector3(); _v.setFromMatrixColumn(self.object.matrix, 0); newPanOffset.copy(_v).multiplyScalar(-deltaX * zoom / el.clientHeight); _v.setFromMatrixColumn(self.object.matrix, 1); newPanOffset.addScaledVector(_v, deltaY * zoom / el.clientHeight); _panOffset.add(newPanOffset); } }
      function onKeyDown(event) { if (self.enabled === false) return; let needsUpdate = false; switch (event.code) { case self.keys.UP: _panOffset.y += self.keyPanSpeed; needsUpdate = true; break; case self.keys.BOTTOM: _panOffset.y -= self.keyPanSpeed; needsUpdate = true; break; case self.keys.LEFT: _panOffset.x -= self.keyPanSpeed; needsUpdate = true; break; case self.keys.RIGHT: _panOffset.x += self.keyPanSpeed; needsUpdate = true; break; default: break; } if (needsUpdate) { event.preventDefault(); self.update(); } }
      function onMouseWheel(event) { if (self.enabled === false || self.enableZoom === false || state !== STATE.NONE) return; event.preventDefault(); if (event.deltaY < 0) { scale *= Math.pow(0.95, self.zoomSpeed); } else if (event.deltaY > 0) { scale /= Math.pow(0.95, self.zoomSpeed); } self.update(); }
      this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
      this.domElement.addEventListener('wheel', onMouseWheel, { passive: false });
      this.update();
    }
    dispose() { this.domElement.removeEventListener('pointerdown', onPointerDown); this.domElement.removeEventListener('wheel', onMouseWheel); if (this._domElementKeyEvents) this._domElementKeyEvents.removeEventListener('keydown', onKeyDown); }
  }
  THREE.OrbitControls = OrbitControls;
})();
