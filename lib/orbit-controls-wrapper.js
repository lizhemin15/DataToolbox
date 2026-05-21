// OrbitControls wrapper for Three.js
// Simple wrapper that loads OrbitControls from CDN if available
(function() {
    if (typeof THREE === 'undefined') {
        console.warn('THREE.js not loaded, OrbitControls wrapper skipped');
        return;
    }
    
    // Basic OrbitControls implementation
    THREE.OrbitControls = function(object, domElement) {
        this.object = object;
        this.domElement = domElement;
        this.enabled = true;
        this.target = new THREE.Vector3();
        this.minDistance = 0;
        this.maxDistance = Infinity;
        this.minPolarAngle = 0;
        this.maxPolarAngle = Math.PI;
        this.enableDamping = false;
        this.dampingFactor = 0.05;
        
        // Simple implementation
        var scope = this;
        var rotateStart = new THREE.Vector2();
        var rotateEnd = new THREE.Vector2();
        var rotateDelta = new THREE.Vector2();
        
        function onMouseDown(event) {
            if (!scope.enabled) return;
            event.preventDefault();
            rotateStart.set(event.clientX, event.clientY);
            domElement.addEventListener('mousemove', onMouseMove, false);
            domElement.addEventListener('mouseup', onMouseUp, false);
        }
        
        function onMouseMove(event) {
            if (!scope.enabled) return;
            rotateEnd.set(event.clientX, event.clientY);
            rotateDelta.subVectors(rotateEnd, rotateStart);
            scope.object.rotation.y += rotateDelta.x * 0.01;
            scope.object.rotation.x += rotateDelta.y * 0.01;
            rotateStart.copy(rotateEnd);
        }
        
        function onMouseUp(event) {
            domElement.removeEventListener('mousemove', onMouseMove, false);
            domElement.removeEventListener('mouseup', onMouseUp, false);
        }
        
        domElement.addEventListener('mousedown', onMouseDown, false);
        
        this.update = function() {
            if (scope.enableDamping) {
                // Simple damping - not full implementation
            }
        };
        
        this.dispose = function() {
            domElement.removeEventListener('mousedown', onMouseDown, false);
        };
    };
})();
