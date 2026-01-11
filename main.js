class Point {
    constructor(x, y, data) {
        this.x = x;
        this.y = y;
        this.data = data;
    }
}

class Rectangle {
    constructor(x, y, w, h) {
        this.x = x; this.y = y; this.w = w; this.h = h;
    }
    contains(point) {
        return (point.x >= this.x - this.w && point.x <= this.x + this.w &&
            point.y >= this.y - this.h && point.y <= this.y + this.h);
    }
    intersects(range) {
        return !(range.x - range.w > this.x + this.w || range.x + range.w < this.x - this.w ||
            range.y - range.h > this.y + this.h || range.y + range.h < this.y - this.h);
    }
}

class QuadTree {
    constructor(boundary, n) {
        this.boundary = boundary;
        this.capacity = n;
        this.points = [];
        this.divided = false;
    }

    subdivide() {
        let x = this.boundary.x;
        let y = this.boundary.y;
        let w = this.boundary.w / 2;
        let h = this.boundary.h / 2;
        this.ne = new QuadTree(new Rectangle(x + w, y - h, w, h), this.capacity);
        this.nw = new QuadTree(new Rectangle(x - w, y - h, w, h), this.capacity);
        this.se = new QuadTree(new Rectangle(x + w, y + h, w, h), this.capacity);
        this.sw = new QuadTree(new Rectangle(x - w, y + h, w, h), this.capacity);
        this.divided = true;
    }

    insert(point) {
        if (!this.boundary.contains(point)) return false;
        if (this.points.length < this.capacity) {
            this.points.push(point);
            return true;
        }
        if (!this.divided) this.subdivide();
        return (this.ne.insert(point) || this.nw.insert(point) ||
            this.se.insert(point) || this.sw.insert(point));
    }

    query(range, found) {
        if (!found) found = [];
        if (!this.boundary.intersects(range)) return found;
        for (let p of this.points) {
            if (range.contains(p)) found.push(p.data);
        }
        if (this.divided) {
            this.nw.query(range, found);
            this.ne.query(range, found);
            this.sw.query(range, found);
            this.se.query(range, found);
        }
        return found;
    }
}

class Creature {
    constructor(x, y, color) {
        this.segments = [];
        this.numSegments = 8 + Math.floor(Math.random() * 8);
        this.segmentLength = 0.15;
        this.color = new THREE.Color(color);
        this.energy = 1.0;
        this.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2,
            0
        );
        this.acceleration = new THREE.Vector3();
        this.maxSpeed = 0.08 + Math.random() * 0.04;
        this.maxForce = 0.008;

        // Initialize segments
        for (let i = 0; i < this.numSegments; i++) {
            this.segments.push(new THREE.Vector3(x, y, 0));
        }

        // Three.js Line implementation
        const geometry = new THREE.BufferGeometry().setFromPoints(this.segments);
        const material = new THREE.LineBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            linewidth: 2
        });
        this.line = new THREE.Line(geometry, material);
    }

    update(flowField, qtree) {
        // Query neighbors using Quadtree
        const range = new Rectangle(this.segments[0].x, this.segments[0].y, 2.0, 2.0);
        const neighbors = qtree.query(range);

        this.applyBehaviors(neighbors);

        // Flow Field Influence
        const flow = flowField.getAt(this.segments[0].x, this.segments[0].y);
        this.acceleration.add(flow.multiplyScalar(0.002));

        // Update velocity and position
        this.velocity.add(this.acceleration);
        this.velocity.clampLength(0, this.maxSpeed);
        this.segments[0].add(this.velocity);
        this.acceleration.set(0, 0, 0);

        // Spring Physics / Inverse Kinematics for segments
        for (let i = 1; i < this.segments.length; i++) {
            const prev = this.segments[i - 1];
            const curr = this.segments[i];
            const diff = new THREE.Vector3().subVectors(curr, prev);
            diff.setLength(this.segmentLength);
            curr.copy(prev).add(diff);
        }

        // Metabolism
        this.energy -= 0.0003;
        this.line.material.opacity = this.energy * 0.9;

        // Update Three.js buffer
        this.line.geometry.setFromPoints(this.segments);
        this.line.geometry.attributes.position.needsUpdate = true;
    }

    applyBehaviors(neighbors) {
        const separate = this.separate(neighbors).multiplyScalar(1.5);
        const align = this.align(neighbors).multiplyScalar(1.0);
        const cohere = this.cohesion(neighbors).multiplyScalar(1.0);
        const flee = this.flee(neighbors).multiplyScalar(2.0);

        this.applyForce(separate);
        this.applyForce(align);
        this.applyForce(cohere);
        this.applyForce(flee);
    }

    flee(neighbors) {
        const steer = new THREE.Vector3();
        let count = 0;
        const fleeDist = 3.0;

        for (const other of neighbors) {
            // Escape if the other is significantly larger
            if (other.numSegments > this.numSegments * 1.5) {
                const d = this.segments[0].distanceTo(other.segments[0]);
                if (d < fleeDist) {
                    const diff = new THREE.Vector3().subVectors(this.segments[0], other.segments[0]);
                    diff.normalize().divideScalar(d);
                    steer.add(diff);
                    count++;
                }
            }
        }

        if (count > 0) steer.divideScalar(count);
        if (steer.length() > 0) {
            steer.normalize().multiplyScalar(this.maxSpeed * 1.5).sub(this.velocity).clampLength(0, this.maxForce * 2);
        }
        return steer;
    }

    align(neighbors) {
        const sum = new THREE.Vector3();
        let count = 0;
        const neighborDist = 2.0;

        for (const other of neighbors) {
            const d = this.segments[0].distanceTo(other.segments[0]);
            if (d > 0 && d < neighborDist) {
                // Favor same color
                let weight = (other.color.getHex() === this.color.getHex()) ? 2.0 : 0.5;
                sum.add(other.velocity.clone().multiplyScalar(weight));
                count += weight;
            }
        }

        if (count > 0) {
            sum.divideScalar(count).normalize().multiplyScalar(this.maxSpeed);
            return sum.sub(this.velocity).clampLength(0, this.maxForce);
        }
        return new THREE.Vector3();
    }

    cohesion(neighbors) {
        const sum = new THREE.Vector3();
        let count = 0;
        const neighborDist = 2.0;

        for (const other of neighbors) {
            const d = this.segments[0].distanceTo(other.segments[0]);
            if (d > 0 && d < neighborDist) {
                sum.add(other.segments[0]);
                count++;
            }
        }

        if (count > 0) {
            sum.divideScalar(count);
            return this.seek(sum);
        }
        return new THREE.Vector3();
    }

    seek(target) {
        const desired = new THREE.Vector3().subVectors(target, this.segments[0]);
        desired.normalize().multiplyScalar(this.maxSpeed);
        return desired.sub(this.velocity).clampLength(0, this.maxForce);
    }
}

class FlowField {
    constructor() {
        this.time = 0;
    }
    getAt(x, y) {
        const angle = Math.sin(x * 0.5 + this.time) * Math.cos(y * 0.5 + this.time) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    }
    update(dt) {
        this.time += dt * 0.5;
    }
}

class DeepSeaSymbiosis {
    constructor() {
        this.container = document.getElementById('canvas-wrapper');
        this.introText = document.getElementById('intro-text');
        this.phase = 1; // 1: Intro, 2: Life, 3: Climax

        this.creatures = [];
        this.flowField = new FlowField();
        this.mouse = new THREE.Vector2();
        this.isMouseDown = false;

        this.initScene();
        this.initEnvironment();
        this.initPostProcessing();
        this.addEventListeners();
        this.animate();
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000510);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 10;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);
    }

    initEnvironment() {
        // Marine Snow (Particles)
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const count = 2000;
        for (let i = 0; i < count; i++) {
            vertices.push(
                THREE.MathUtils.randFloatSpread(40),
                THREE.MathUtils.randFloatSpread(40),
                THREE.MathUtils.randFloatSpread(40)
            );
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.05,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });
        this.marineSnow = new THREE.Points(geometry, material);
        this.scene.add(this.marineSnow);

        this.initGodRays();
    }

    initGodRays() {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                color: { value: new THREE.Color(0x007FFF) }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 color;
                varying vec2 vUv;
                void main() {
                    float opacity = (1.0 - vUv.y) * 0.15 * (0.6 + 0.4 * sin(vUv.x * 8.0 + time * 0.5));
                    gl_FragColor = vec4(color, opacity);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });

        const geometry = new THREE.PlaneGeometry(40, 40);
        this.godRays = new THREE.Mesh(geometry, material);
        this.godRays.position.y = 15;
        this.godRays.position.z = -5;
        this.godRays.rotation.x = -Math.PI / 3;
        this.scene.add(this.godRays);
    }

    initPostProcessing() {
        this.renderScene = new RenderPass(this.scene, this.camera);
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, 0.4, 0.85
        );
        this.bloomPass.threshold = 0.1;
        this.bloomPass.strength = 1.2;
        this.bloomPass.radius = 0.5;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(this.renderScene);
        this.composer.addPass(this.bloomPass);
    }

    addEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());

        window.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', () => this.onMouseUp());

        window.addEventListener('touchstart', (e) => this.onMouseDown(e.touches[0]));
        window.addEventListener('touchmove', (e) => this.onMouseMove(e.touches[0]));
        window.addEventListener('touchend', () => this.onMouseUp());
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    updateMousePosition(e) {
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    }

    onMouseDown(e) {
        this.isMouseDown = true;
        this.updateMousePosition(e);
        this.handlePhaseTransition();
    }

    onMouseMove(e) {
        this.updateMousePosition(e);
        if (this.isMouseDown && this.phase === 2) {
            this.spawnCreature();
        }
    }

    onMouseUp() {
        this.isMouseDown = false;
    }

    handlePhaseTransition() {
        if (this.phase === 1) {
            this.phase = 2;
            this.introText.style.opacity = '0';
            setTimeout(() => {
                this.introText.style.display = 'none';
            }, 2000);
        }
    }

    spawnCreature() {
        // Unproject mouse postion to world coordinates
        const vector = new THREE.Vector3(this.mouse.x, this.mouse.y, 0.5);
        vector.unproject(this.camera);
        const dir = vector.sub(this.camera.position).normalize();
        const distance = -this.camera.position.z / dir.z;
        const pos = this.camera.position.clone().add(dir.multiplyScalar(distance));

        const colors = [0x00FFFF, 0xFF00FF, 0x007FFF];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const creature = new Creature(pos.x, pos.y, color);
        this.creatures.push(creature);
        this.scene.add(creature.line);

        // Performance limit
        if (this.creatures.length > 200) {
            const removed = this.creatures.shift();
            this.scene.remove(removed.line);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const dt = 0.016;
        const time = performance.now() * 0.001;

        this.flowField.update(dt);

        // Build Quadtree
        const boundary = new Rectangle(0, 0, 20, 20);
        const qtree = new QuadTree(boundary, 4);
        for (const c of this.creatures) {
            qtree.insert(new Point(c.segments[0].x, c.segments[0].y, c));
        }

        // Update Creatures
        for (let i = this.creatures.length - 1; i >= 0; i--) {
            const creature = this.creatures[i];

            if (this.phase === 3) {
                const center = new THREE.Vector3(0, 0, 0);
                const force = creature.seek(center).multiplyScalar(2.5);
                creature.applyForce(force);

                if (creature.segments[0].length() < 1.0) {
                    creature.energy -= 0.03;
                }
            }

            creature.update(this.flowField, qtree);

            if (creature.energy <= 0) {
                this.scene.remove(creature.line);
                this.creatures.splice(i, 1);
            }
        }

        // Marine Snow
        this.marineSnow.rotation.y += 0.001;
        this.marineSnow.position.y -= 0.01;
        if (this.marineSnow.position.y < -15) this.marineSnow.position.y = 15;

        // God Rays
        if (this.godRays) {
            this.godRays.material.uniforms.time.value = time;
        }

        // Climax Trigger - Increased count for more dramatic effect
        if (this.creatures.length > 500 && this.phase === 2) {
            this.startClimax();
        }

        if (this.phase === 3 && this.creatures.length === 0) {
            this.reset();
        }

        this.composer.render();
    }

    startClimax() {
        this.phase = 3;
        // Increase Bloom to whiteout
        this.bloomPass.strength = 5.0;
        this.bloomPass.radius = 1.0;

        // Change text back (optional) or just wait for explosion
    }

    reset() {
        this.phase = 1;
        this.bloomPass.strength = 1.2;
        this.bloomPass.radius = 0.5;
        this.introText.style.display = 'flex';
        this.introText.style.opacity = '0';
        setTimeout(() => {
            this.introText.style.opacity = '1';
        }, 100);
    }
}

new DeepSeaSymbiosis();
