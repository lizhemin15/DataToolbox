
function renderGovApiDocs(query) {
    const body = document.getElementById('govApiBody');
    // 优先使用加载后的数据，否则 fallback 到顶层变量
    const funcs = window.__govApiFunctions || governanceFunctionsLocal || [];
    let html = '';
    for (const cat of funcs) {
        const items = cat.items.filter(item =>
            !query ||
            item.name.toLowerCase().includes(query) ||
            item.signature.toLowerCase().includes(query) ||
            item.desc.toLowerCase().includes(query) ||
            item.example.toLowerCase().includes(query)
        );
        if (!items.length) continue;
        html += `<div class="gov-api-category"><h3>${escapeHtml(cat.category)}</h3>`;
        for (const item of items) {
            html += `
            <div class="gov-api-item">
                <div class="gov-api-sig"><code>${escapeHtml(item.signature)}</code></div>
                <div class="gov-api-desc">${escapeHtml(item.desc)}</div>
                <pre class="gov-api-example">${escapeHtml(item.example)}</pre>
            </div>`;
        }
        html += '</div>';
    }
    if (!html) html = '<div style="color:#888;padding:24px;text-align:center;">暂无可用 API 文档</div>';
    body.innerHTML = html;
}

// ============================================================
// 本体分析模块
// ============================================================

// ---- 状态 ----
let ontoData = null;
let ontoSimulation = null;
let ontoInsightExpanded = true;
let ontoSelectedDbId = null;
let ontoGraphViewMode = '2d';
let ontoThreeState = null;

// ---- 颜色映射 ----
const ONTO_COLORS = {
    entity:    { fill: '#4ECDC4', dark: '#2aa59e', emoji: 'E' },
    event:     { fill: '#FF6B6B', dark: '#cc4444', emoji: 'V' },
    concept:   { fill: '#A29BFE', dark: '#7c73e6', emoji: 'C' },
    rule:      { fill: '#55EFC4', dark: '#2ecc97', emoji: 'R' },
    conflict:  { fill: '#E17055', dark: '#b5503a', emoji: 'X' },
    attribute: { fill: '#FDCB6E', dark: '#d4a224', emoji: 'A' },
};

const ONTO_CATEGORY_LABELS = {
    entity: '实体', event: '事件', concept: '概念',
    rule: '规则', conflict: '冲突', attribute: '属性',
};

// ---- 演示本体数据 ----
const DEMO_ONTOLOGY = {
    concepts: [
        { id: 'customer', label: '客户', category: 'entity', importance: 0.95,
          description: '客户是电商场景中的核心实体，通常对应 users 与 customers 两张表，需要统一主数据口径。',
          tables: ['users', 'customers'],
          attributes: ['id','name','email','phone','address','created_at'],
          governance_issues: ['users和customers表关联缺失', '客户主数据需要统一'] },
        { id: 'order', label: '订单', category: 'entity', importance: 0.90,
          description: '订单记录用户的购买行为，是交易链路中最重要的业务对象之一。',
          tables: ['orders','order_items'], attributes: ['order_id','total_amount','status','created_at'], governance_issues: [] },
        { id: 'product', label: '商品', category: 'entity', importance: 0.85,
          description: '商品信息通常来源于商品中心，需要统一 SKU、价格与状态字段。',
          tables: ['products','product_variants'], attributes: ['product_id','name','price','sku','status'],
          governance_issues: ['价格精度问题decimal vs float?', '商品状态值不一致'] },
        { id: 'inventory', label: '库存', category: 'entity', importance: 0.75,
          description: '库存实体描述商品在仓库中的可用数量和流转状态。',
          tables: ['inventory','warehouse_stock'], attributes: ['sku','quantity','warehouse_id','updated_at'], governance_issues: [] },
        { id: 'payment', label: '支付', category: 'entity', importance: 0.80,
          description: '支付记录交易支付过程，常与订单、渠道和流水号关联。',
          tables: ['payments','payment_logs'], attributes: ['payment_id','amount','channel','status','transaction_id'],
          governance_issues: ['支付渠道缺少枚举校验', '支付状态流转不完整'] },
        { id: 'logistics', label: '物流', category: 'entity', importance: 0.70,
          description: '物流实体跟踪包裹运输、签收与异常状态。',
          tables: ['shipments','tracking_events'], attributes: ['tracking_no','carrier','status','estimated_delivery'], governance_issues: [] },
        { id: 'cart', label: '购物车', category: 'event', importance: 0.60,
          description: '购物车代表用户一次临时性的选购行为。',
          tables: ['shopping_carts','cart_items'], attributes: ['cart_id','customer_id','items','total'], governance_issues: [] },
        { id: 'review', label: '评价', category: 'event', importance: 0.50,
          description: '评价实体记录用户对商品的反馈与打分。',
          tables: ['reviews','review_images'], attributes: ['review_id','rating','content','created_at'], governance_issues: [] },
        { id: 'coupon', label: '优惠券', category: 'concept', importance: 0.55,
          description: '优惠券用于描述营销优惠规则与可用范围。',
          tables: ['coupons','coupon_usage'], attributes: ['code','discount_type','value','conditions'], governance_issues: [] },
        { id: 'category', label: '分类', category: 'concept', importance: 0.60,
          description: '分类用于组织商品结构和层级关系。',
          tables: ['categories'], attributes: ['category_id','name','parent_id','path'], governance_issues: [] },
        { id: 'loyalty', label: '会员规则', category: 'rule', importance: 0.50,
          description: '会员规则定义等级、门槛和权益配置。',
          tables: ['membership_rules','customer_loyalty'], attributes: ['level','threshold','benefits','discount_rate'], governance_issues: [] },
        { id: 'risk_naming', label: '命名冲突', category: 'conflict', importance: 0.90,
          description: 'users 与 customers 存在语义重叠，需要统一命名与主数据口径。',
          tables: ['users','customers'], attributes: [], governance_issues: ['字段命名不一致', '表结构需要规范'] },
    ],
    relations: [
        { source: 'customer', target: 'order', label: '下单', type: 'has-many', description: '客户可以创建多个订单，记录购买行为和时间线' },
        { source: 'order', target: 'product', label: '包含', type: 'many-to-many', description: '订单包含多个商品，商品可出现在多个订单中' },
        { source: 'order', target: 'payment', label: '支付', type: 'has-one', description: '一个订单对应一条支付记录，记录支付渠道和状态' },
        { source: 'order', target: 'logistics', label: '物流', type: 'has-one', description: '订单关联物流信息，追踪包裹运输和签收' },
        { source: 'customer', target: 'cart', label: '拥有', type: 'has-many', description: '客户可创建多个购物车记录，保留临时选购' },
        { source: 'cart', target: 'product', label: '包含', type: 'many-to-many', description: '购物车包含多个商品，多对多关联' },
        { source: 'product', target: 'inventory', label: '库存', type: 'has-one', description: '每个SKU对应一条库存记录，记录可用数量' },
        { source: 'product', target: 'category', label: '归类', type: 'many-to-one', description: '商品归入某个分类，支持层级结构' },
        { source: 'customer', target: 'review', label: '评价', type: 'has-many', description: '客户可以对多个商品发表评价和反馈' },
        { source: 'review', target: 'product', label: '针对', type: 'many-to-one', description: '评价针对某个具体商品' },
        { source: 'customer', target: 'coupon', label: '领取', type: 'has-many', description: '客户可领取多张优惠券，优惠券有使用条件' },
        { source: 'order', target: 'coupon', label: '使用', type: 'many-to-one', description: '订单可使用一张优惠券，记录优惠金额和使用条件' },
        { source: 'customer', target: 'loyalty', label: '会员', type: 'has-one', description: '客户关联会员等级和权益，记录积分和等级' },
        { source: 'risk_naming', target: 'customer', label: '冲突', type: 'conflict', description: 'users与customers存在命名冲突，需统一客户口径' },
    ],
    insights: [
        { type: 'conflict', title: '命名冲突风险', severity: 'high', affectedConcepts: ['customer','risk_naming'],
          description: 'users 与 customers 存在语义重叠，需要统一为 customer 主数据口径' },
        { type: 'quality', title: '数据精度不一致', severity: 'high', affectedConcepts: ['product','order'],
          description: 'products.price 是 float，order_items.unit_price 是 decimal，需要统一精度以避免计算误差' },
        { type: 'governance', title: '隐私合规缺失', severity: 'medium', affectedConcepts: ['customer'],
          description: '客户敏感字段缺少脱敏策略，联系方式、地址等是否满足GDPR/个人信息保护法要求' },
        { type: 'missing', title: '物流商品关联缺失', severity: 'medium', affectedConcepts: ['logistics','product'],
          description: '物流与商品之间缺少溯源关联，无法追溯退换货和破损责任方' },
        { type: 'governance', title: '支付数据留痕', severity: 'medium', affectedConcepts: ['payment'],
          description: '支付流水缺少操作审计日志，需按要求保留至少五年记录' },
        { type: 'quality', title: '典型电商12实体模型', severity: 'info', affectedConcepts: [],
          description: 'AI已识别出典型电商场景12个核心实体，实际可能扩展到14个以上，建议持续补充完善' },
    ],
};

// ---- 本体可视化 ----
function ontoNodeRadius(d) {
    return 18 + (d.importance || 0.5) * 16;
}

function ontoNodeRadius3D(d) {
    return (ontoNodeRadius(d) / 14) * 0.85;
}

function syncOntologyViewToggleUI() {
    const b2 = document.getElementById('ontoView2dBtn');
    const b3 = document.getElementById('ontoView3dBtn');
    if (b2) b2.classList.toggle('active', ontoGraphViewMode === '2d');
    if (b3) b3.classList.toggle('active', ontoGraphViewMode === '3d');
}

function setOntologyGraphView(mode) {
    ontoGraphViewMode = mode === '3d' ? '3d' : '2d';
    syncOntologyViewToggleUI();
    if (ontoData) renderOntologyGraph(ontoData, false);
}

function disposeOntologyGraph3D() {
    if (!ontoThreeState) return;
    const st = ontoThreeState;
    if (st.raf) cancelAnimationFrame(st.raf);
    if (st.onResize) window.removeEventListener('resize', st.onResize);
    const domEl = st.renderer && st.renderer.domElement;
    if (domEl && st._pickDown) domEl.removeEventListener('mousedown', st._pickDown);
    if (domEl && st._pickUp) domEl.removeEventListener('mouseup', st._pickUp);
    if (st.controls) {
        if (typeof st.controls.dispose === 'function') st.controls.dispose();
    }
    if (st.sharedSphereGeom) st.sharedSphereGeom.dispose();
    if (st.meshes) {
        st.meshes.forEach(({ mesh }) => {
            if (mesh.material) mesh.material.dispose();
        });
    }
    if (st.lineBundles) {
        st.lineBundles.forEach(b => {
            if (b.glowGeo) b.glowGeo.dispose();
            if (b.dashGeo) b.dashGeo.dispose();
            if (b.glowMat) b.glowMat.dispose();
            if (b.dashMat) b.dashMat.dispose();
        });
    }
    if (st.renderer) {
        st.renderer.dispose();
        if (st.renderer.domElement && st.renderer.domElement.parentNode) {
            st.renderer.domElement.parentNode.removeChild(st.renderer.domElement);
        }
    }
    ontoThreeState = null;
}

/** 单步 3D 力导向模拟 + 阻尼 + 中心引力 + 速度 */
function ontoForceLayout3DStep(nodes, links, opts) {
    const repulsion = opts.repulsion ?? 1200;
    const attraction = opts.attraction ?? 0.06;
    const centerGrav = opts.centerGrav ?? 0.018;
    const damping = opts.damping ?? 0.88;
    const dt = opts.dt ?? 0.45;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
        nodes[i].ax = 0;
        nodes[i].ay = 0;
        nodes[i].az = 0;
    }
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            let dx = nodes[j].x - nodes[i].x;
            let dy = nodes[j].y - nodes[i].y;
            let dz = nodes[j].z - nodes[i].z;
            let distSq = dx * dx + dy * dy + dz * dz;
            const dist = Math.sqrt(distSq) || 0.01;
            const f = repulsion / distSq;
            dx /= dist;
            dy /= dist;
            dz /= dist;
            nodes[i].ax -= f * dx;
            nodes[i].ay -= f * dy;
            nodes[i].az -= f * dz;
            nodes[j].ax += f * dx;
            nodes[j].ay += f * dy;
            nodes[j].az += f * dz;
        }
    }
    for (let li = 0; li < links.length; li++) {
        const l = links[li];
        const a = l.source;
        const b = l.target;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
        dx /= dist;
        dy /= dist;
        dz /= dist;
        const ideal = l.idealLength ?? 7;
        const f = (dist - ideal) * attraction;
        a.ax += f * dx;
        a.ay += f * dy;
        a.az += f * dz;
        b.ax -= f * dx;
        b.ay -= f * dy;
        b.az -= f * dz;
    }
    for (let i = 0; i < n; i++) {
        const p = nodes[i];
        p.ax -= p.x * centerGrav;
        p.ay -= p.y * centerGrav;
        p.az -= p.z * centerGrav;
        p.vx = (p.vx + p.ax * dt) * damping;
        p.vy = (p.vy + p.ay * dt) * damping;
        p.vz = (p.vz + p.az * dt) * damping;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
    }
}

function createOntoOrbitControls(camera, domElement) {
    if (typeof THREE === 'undefined') return null;
    const OC = THREE.OrbitControls || (typeof OrbitControls !== 'undefined' ? OrbitControls : null);
    if (OC) {
        const c = new OC(camera, domElement);
        c.enableDamping = true;
        c.dampingFactor = 0.06;
        c.minDistance = 8;
        c.maxDistance = 120;
        return c;
    }
    const target = new THREE.Vector3(0, 0, 0);
    let radius = 42;
    let phi = Math.acos(0.45);
    let theta = 0.55;
    function updateCam() {
        const sp = Math.sin(phi);
        camera.position.set(
            target.x + radius * sp * Math.cos(theta),
            target.y + radius * Math.cos(phi),
            target.z + radius * sp * Math.sin(theta)
        );
        camera.lookAt(target);
    }
    updateCam();
    let down = false;
    let lx = 0;
    let ly = 0;
    const onDown = e => { down = true; lx = e.clientX; ly = e.clientY; };
    const onMove = e => {
        if (!down) return;
        theta += (e.clientX - lx) * 0.01;
        phi += (e.clientY - ly) * 0.01;
        phi = Math.max(0.12, Math.min(Math.PI - 0.12, phi));
        lx = e.clientX;
        ly = e.clientY;
        updateCam();
    };
    const onUp = () => { down = false; };
    const onWheel = e => {
        e.preventDefault();
        radius *= 1 + e.deltaY * 0.0012;
        radius = Math.max(8, Math.min(140, radius));
        updateCam();
    };
    domElement.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    return {
        target,
        update: () => {},
        dispose: () => {
            domElement.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            domElement.removeEventListener('wheel', onWheel);
        },
    };
}

/**
 * Three.js 3D 本体图渲染，依赖 ontoData 和 ONTO_COLORS。
 */
function renderOntologyGraph3D(data, animate) {
    if (typeof THREE === 'undefined') return;
    disposeOntologyGraph3D();

    const container = document.getElementById('ontoGraph3d');
    if (!container) return;

    const W = container.clientWidth || 800;
    const H = container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0d1020, 0.012);

    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
    camera.position.set(0, 6, 38);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x0d1020, 1);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x6a7ba8, 0.35));
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(12, 24, 20);
    scene.add(dir);
    const pt = new THREE.PointLight(0x8899ff, 0.4, 80);
    pt.position.set(-10, 10, 10);
    scene.add(pt);

    const nodes = (data.concepts || []).map(c => ({
        ...c,
        x: (Math.random() - 0.5) * 22,
        y: (Math.random() - 0.5) * 18,
        z: (Math.random() - 0.5) * 22,
        vx: 0,
        vy: 0,
        vz: 0,
    }));
    const nodeById = {};
    nodes.forEach(n => { nodeById[n.id] = n; });
    const links = (data.relations || [])
        .filter(r => nodeById[r.source] && nodeById[r.target])
        .map(r => ({
            ...r,
            source: nodeById[r.source],
            target: nodeById[r.target],
            idealLength: r.type === 'conflict' ? 5.5 : 8.2,
        }));

    for (let s = 0; s < 140; s++) {
        ontoForceLayout3DStep(nodes, links, { repulsion: 1400, attraction: 0.07, damping: 0.9, dt: 0.38 });
    }

    const meshes = [];
    const sphereGeomShared = new THREE.SphereGeometry(1, 28, 28);
    nodes.forEach((d, idx) => {
        const cfg = ONTO_COLORS[d.category] || ONTO_COLORS.entity;
        const col = new THREE.Color(cfg.fill);
        const mat = new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: 0.32,
            metalness: 0.25,
            roughness: 0.42,
        });
        const mesh = new THREE.Mesh(sphereGeomShared, mat);
        const r = ontoNodeRadius3D(d);
        mesh.scale.setScalar(r);
        mesh.position.set(d.x, d.y, d.z);
        mesh.userData.ontoId = d.id;
        mesh.userData.phase = idx * 0.73;
        scene.add(mesh);
        meshes.push({ mesh, data: d, baseR: r });
    });

    const lineBundles = [];
    links.forEach(l => {
        const isConflict = l.type === 'conflict';
        const cGlow = new THREE.Color(isConflict ? 0xe17055 : 0x8899ff);
        const glowGeo = new THREE.BufferGeometry();
        const glowPos = new Float32Array(6);
        glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
        const glowMat = new THREE.LineBasicMaterial({
            color: cGlow,
            transparent: true,
            opacity: isConflict ? 0.55 : 0.38,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const glowLine = new THREE.Line(glowGeo, glowMat);
        scene.add(glowLine);

        const dashGeo = new THREE.BufferGeometry();
        const dashPos = new Float32Array(6);
        dashGeo.setAttribute('position', new THREE.BufferAttribute(dashPos, 3));
        const dashMat = new THREE.LineDashedMaterial({
            color: isConflict ? 0xff8a70 : 0xb4c4ff,
            dashSize: 0.55,
            gapSize: 0.38,
            transparent: true,
            opacity: 0.92,
        });
        const dashLine = new THREE.Line(dashGeo, dashMat);
        scene.add(dashLine);

        lineBundles.push({ l, glowGeo, dashGeo, glowMat, dashMat, glowLine, dashLine });
    });

    const controls = createOntoOrbitControls(camera, renderer.domElement);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pickDownX = 0;
    let pickDownY = 0;

    const st = {
        raf: null,
        renderer,
        scene,
        camera,
        controls,
        meshes,
        lineBundles,
        nodes,
        links,
        selectedId: null,
        clock: new THREE.Clock(),
        timeEnter: performance.now(),
        sharedSphereGeom: sphereGeomShared,
        didAnimateEnter: !!animate,
    };
    ontoThreeState = st;

    const onResize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w < 2 || h < 2) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    };
    st.onResize = onResize;
    window.addEventListener('resize', onResize);

    st._pickDown = e => { pickDownX = e.clientX; pickDownY = e.clientY; };
    st._pickUp = e => {
        if (Math.hypot(e.clientX - pickDownX, e.clientY - pickDownY) > 10) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const objs = meshes.map(m => m.mesh);
        const hits = raycaster.intersectObjects(objs, false);
        if (hits.length) {
            const d = hits[0].object.userData.ontoNodeRef || nodes.find(n => n.id === hits[0].object.userData.ontoId);
            if (d) showNodeDetail(d, nodes, links);
        } else {
            closeNodeDetail();
        }
    };
    renderer.domElement.addEventListener('mousedown', st._pickDown);
    renderer.domElement.addEventListener('mouseup', st._pickUp);

    // 为 D3 视图保留节点引用，便于射线拾取。
    meshes.forEach(({ mesh, data }) => {
        mesh.userData.ontoNodeRef = data;
    });

    function animate() {
        st.raf = requestAnimationFrame(animate);
        const t = st.clock.getElapsedTime();
        let enterScale = 1;
        if (st.didAnimateEnter) {
            const u = Math.min(1, (performance.now() - st.timeEnter) / 880);
            enterScale = 0.04 + (1 - 0.04) * (1 - Math.pow(1 - u, 3));
            if (u >= 1) st.didAnimateEnter = false;
        }

        ontoForceLayout3DStep(nodes, links, { repulsion: 320, attraction: 0.035, damping: 0.92, dt: 0.28 });

        meshes.forEach(({ mesh, data, baseR }) => {
            const phase = mesh.userData.phase || 0;
            const hover = Math.sin(t * 1.6 + phase) * 0.22;
            mesh.position.set(data.x, data.y + hover, data.z);
            const sel = st.selectedId && data.id === st.selectedId;
            mesh.material.emissiveIntensity = sel ? 0.72 : 0.3 + Math.sin(t * 2.2 + phase) * 0.06;
            const pulse = sel ? 1.14 : 1 + Math.sin(t * 1.9 + phase) * 0.04;
            mesh.scale.setScalar(baseR * pulse * enterScale);
        });

        lineBundles.forEach(b => {
            const a = b.l.source;
            const bnode = b.l.target;
            const tA = meshes.find(m => m.data.id === a.id);
            const tB = meshes.find(m => m.data.id === bnode.id);
            if (!tA || !tB) return;
            const ax = tA.mesh.position.x;
            const ay = tA.mesh.position.y;
            const az = tA.mesh.position.z;
            const bx = tB.mesh.position.x;
            const by = tB.mesh.position.y;
            const bz = tB.mesh.position.z;
            const arrG = b.glowGeo.attributes.position.array;
            arrG[0] = ax;
            arrG[1] = ay;
            arrG[2] = az;
            arrG[3] = bx;
            arrG[4] = by;
            arrG[5] = bz;
            b.glowGeo.attributes.position.needsUpdate = true;
            const arrD = b.dashGeo.attributes.position.array;
            arrD.set(arrG);
            b.dashGeo.attributes.position.needsUpdate = true;
            b.dashLine.computeLineDistances();
            b.dashMat.dashOffset -= 0.045;
        });

        if (controls && controls.update) controls.update();
        renderer.render(scene, camera);
    }

    animate();
}

// 渲染本体图。
function renderOntologyGraph(data, animate) {
    if (!data) return;
    ontoData = data;

    const svgEl = document.getElementById('ontoSvg');
    if (!svgEl) return;

    // 隐藏欢迎页。
    document.getElementById('ontoWelcome').style.display = 'none';

    const viewToggle = document.getElementById('ontoViewToggle');
    const viewSep = document.getElementById('ontoViewToggleSep');
    if (viewToggle) viewToggle.style.display = 'inline-flex';
    if (viewSep) viewSep.style.display = '';

    if (ontoGraphViewMode === '3d') {
        if (typeof THREE === 'undefined') {
            showOntoToast('当前环境缺少 Three.js，已切换到 2D 视图', true);
            ontoGraphViewMode = '2d';
            syncOntologyViewToggleUI();
        } else {
            if (ontoSimulation) {
                ontoSimulation.stop();
                ontoSimulation = null;
            }
            d3.select('#ontoSvg').selectAll('*').remove();
            svgEl.style.display = 'none';
            const g3 = document.getElementById('ontoGraph3d');
            if (g3) g3.style.display = 'block';
            renderOntologyGraph3D(data, animate);
            document.getElementById('ontoQueryBar').classList.remove('onto-query-disabled');
            document.getElementById('ontoClearBtn').style.display = '';
            updateOntoStats(data);
            renderInsights(data.insights || []);
            return;
        }
    }

    disposeOntologyGraph3D();
    svgEl.style.display = '';
    const g3el = document.getElementById('ontoGraph3d');
    if (g3el) g3el.style.display = 'none';

    const W = svgEl.parentElement.clientWidth;
    const H = svgEl.parentElement.clientHeight;

    // 初始化 SVG 容器。
    const svg = d3.select('#ontoSvg').attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    // 发光滤镜。
    const fGlow = defs.append('filter').attr('id', 'onto-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    fGlow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '4').attr('result', 'blur');
    const fMerge = fGlow.append('feMerge');
    fMerge.append('feMergeNode').attr('in', 'blur');
    fMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // 强对比发光滤镜。
    const fGlow2 = defs.append('filter').attr('id', 'onto-glow-strong').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
    fGlow2.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '8').attr('result', 'blur');
    const fMerge2 = fGlow2.append('feMerge');
    fMerge2.append('feMergeNode').attr('in', 'blur');
    fMerge2.append('feMergeNode').attr('in', 'SourceGraphic');

    // 箭头标记。
    ['default','conflict'].forEach(t => {
        const m = defs.append('marker').attr('id', `onto-arrow-${t}`)
            .attr('viewBox','0 -5 10 10').attr('refX', 22).attr('refY', 0)
            .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto');
        m.append('path').attr('d','M0,-5L10,0L0,5')
            .attr('fill', t === 'conflict' ? '#E17055' : 'rgba(160,160,220,0.6)');
    });

    // 为每个分类生成渐变色。
    Object.entries(ONTO_COLORS).forEach(([cat, cfg]) => {
        const g = defs.append('radialGradient').attr('id', `onto-grad-${cat}`).attr('cx','35%').attr('cy','35%');
        g.append('stop').attr('offset','0%').attr('stop-color','#fff').attr('stop-opacity', 0.7);
        g.append('stop').attr('offset','100%').attr('stop-color', cfg.fill).attr('stop-opacity', 1);
    });

    // 主图层支持缩放和平移。
    const mainG = svg.append('g').attr('class','onto-main');
    const zoom = d3.zoom().scaleExtent([0.25, 4]).on('zoom', e => mainG.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    // 初始化节点与边。
    const nodes = data.concepts.map(c => ({ ...c, x: W/2 + (Math.random()-0.5)*400, y: H/2 + (Math.random()-0.5)*300 }));
    const nodeById = {};
    nodes.forEach(n => nodeById[n.id] = n);
    const links = (data.relations || []).filter(r => nodeById[r.source] && nodeById[r.target])
        .map(r => ({ ...r, source: nodeById[r.source], target: nodeById[r.target] }));

    // 启动力导布局模拟。
    if (ontoSimulation) ontoSimulation.stop();
    ontoSimulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(d => d.type === 'conflict' ? 100 : 130))
        .force('charge', d3.forceManyBody().strength(d => -250 - (d.importance||0.5)*200))
        .force('center', d3.forceCenter(W/2, H/2))
        .force('collision', d3.forceCollide().radius(d => ontoNodeRadius(d) + 22));

    // 绘制关系边。
    const linkG = mainG.append('g');
    const linkSel = linkG.selectAll('.onto-link-g').data(links).enter().append('g');
    const linkLine = linkSel.append('line')
        .attr('stroke', d => d.type === 'conflict' ? '#E17055' : 'rgba(160,160,230,0.3)')
        .attr('stroke-width', d => d.type === 'conflict' ? 2.5 : 1.5)
        .attr('stroke-dasharray', d => d.type === 'conflict' ? '8,4' : 'none')
        .attr('marker-end', d => `url(#onto-arrow-${d.type==='conflict'?'conflict':'default'})`);
    const linkLabel = linkSel.append('text').attr('class','onto-link-label')
        .attr('text-anchor','middle').attr('fill','rgba(180,180,220,0.55)').attr('font-size','10px')
        .text(d => d.label);

    // 绘制节点层。
    const nodeG = mainG.append('g');
    const nodeSel = nodeG.selectAll('.onto-node').data(nodes).enter().append('g').attr('class','onto-node')
        .attr('opacity', animate ? 0 : 1)
        .style('cursor','pointer')
        .call(d3.drag()
            .on('start', (e,d) => { if(!e.active) ontoSimulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
            .on('drag',  (e,d) => { d.fx=e.x; d.fy=e.y; })
            .on('end',   (e,d) => { if(!e.active) ontoSimulation.alphaTarget(0); d.fx=null; d.fy=null; })
        )
        .on('click', (e,d) => { e.stopPropagation(); showNodeDetail(d, nodes, links); });

    // 节点发光层。
    nodeSel.append('circle').attr('class','onto-node-glow')
        .attr('r', d => ontoNodeRadius(d)+10)
        .attr('fill', d => ONTO_COLORS[d.category]?.fill || '#4ECDC4')
        .attr('opacity', 0.12).attr('filter','url(#onto-glow)');

    // 光晕
    nodeSel.append('circle').attr('class','onto-node-circle')
        .attr('r', d => ontoNodeRadius(d))
        .attr('fill', d => `url(#onto-grad-${d.category})`)
        .attr('stroke', d => ONTO_COLORS[d.category]?.fill || '#4ECDC4')
        .attr('stroke-width', 2).attr('filter','url(#onto-glow)');

    // emoji 图标 
    nodeSel.append('text').attr('text-anchor','middle').attr('dominant-baseline','central')
        .attr('font-size', d => Math.round(ontoNodeRadius(d)*0.75)+'px')
        .attr('pointer-events','none').text(d => ONTO_COLORS[d.category]?.emoji || '🔵');

    // 节点标签。
    nodeSel.append('text').attr('class','onto-node-label').attr('text-anchor','middle')
        .attr('dy', d => ontoNodeRadius(d)+16+'px')
        .attr('fill','#e2e8f0').attr('font-size','12px').attr('font-weight','600')
        .attr('pointer-events','none').text(d => d.label);

    // 初次进入时使用渐显动画。
    if (animate) {
        nodeSel.each(function(d, i) {
            d3.select(this).transition().delay(i * 80).duration(500)
                .attr('opacity', 1).ease(d3.easeBackOut.overshoot(1.4));
        });
    }

    // tick
    ontoSimulation.on('tick', () => {
        linkLine.attr('x1', d=>d.source.x).attr('y1', d=>d.source.y)
                .attr('x2', d=>d.target.x).attr('y2', d=>d.target.y);
        linkLabel.attr('x', d=>(d.source.x+d.target.x)/2).attr('y', d=>(d.source.y+d.target.y)/2-4);
        nodeSel.attr('transform', d=>`translate(${d.x},${d.y})`);
    });

    // 点击空白处关闭详情。
    svg.on('click', () => closeNodeDetail());

    // 恢复查询栏并刷新统计与洞察。
    document.getElementById('ontoQueryBar').classList.remove('onto-query-disabled');
    document.getElementById('ontoClearBtn').style.display = '';
    updateOntoStats(data);
    renderInsights(data.insights || []);
}

// 更新本体统计。
function updateOntoStats(data) {
    const risks = (data.insights || []).filter(i => i.severity === 'high' || i.severity === 'medium').length;
    animateCounter('ontoStatConcepts', (data.concepts || []).length);
    animateCounter('ontoStatRelations', (data.relations || []).length);
    animateCounter('ontoStatRisks', risks);
}

function animateCounter(elId, target) {
    const el = document.getElementById(elId);
    if (!el) return;
    let cur = 0;
    const step = Math.ceil(target / 20);
    const t = setInterval(() => {
        cur = Math.min(cur + step, target);
        el.textContent = cur;
        if (cur >= target) clearInterval(t);
    }, 40);
}

// 渲染洞察卡片。
function renderInsights(insights) {
    const body = document.getElementById('ontoInsightBody');
    if (!insights || insights.length === 0) {
        body.innerHTML = '<div class="onto-insight-placeholder"><span>无</span><p>暂无洞察</p></div>';
        return;
    }
    const iconMap = { conflict: '冲突', quality: '质量', governance: '治理', missing: '缺失', performance: '性能', info: '信息' };
    body.innerHTML = insights.map((ins, i) => `
        <div class="onto-insight-card ${ins.severity}" style="animation-delay:${i*0.08}s" onclick="highlightInsight(${i})">
            <div class="onto-insight-title">
                ${iconMap[ins.type]||'信息'} ${ins.title}
                <span class="onto-insight-badge ${ins.severity}">${ins.severity === 'high' ? '高' : ins.severity === 'medium' ? '中' : ins.severity === 'low' ? '低' : '信息'}</span>
            </div>
            <div class="onto-insight-desc">${ins.description}</div>
        </div>`).join('');
}

// 高亮洞察影响的概念。
function highlightInsight(idx) {
    if (!ontoData || !ontoData.insights[idx]) return;
    const ins = ontoData.insights[idx];
    const affected = new Set(ins.affectedConcepts || []);
    if (affected.size === 0) return;
    d3.selectAll('.onto-node').each(function(d) {
        const active = affected.has(d.id);
        d3.select(this).select('.onto-node-circle')
            .transition().duration(300)
            .attr('filter', active ? 'url(#onto-glow-strong)' : 'url(#onto-glow)')
            .attr('stroke-width', active ? 3.5 : 2)
            .attr('opacity', active ? 1 : 0.45);
        d3.select(this).select('.onto-node-glow')
            .transition().duration(300).attr('opacity', active ? 0.35 : 0.1);
    });
    setTimeout(() => {
        d3.selectAll('.onto-node .onto-node-circle')
            .transition().duration(400).attr('stroke-width', 2).attr('opacity', 1).attr('filter','url(#onto-glow)');
        d3.selectAll('.onto-node .onto-node-glow').transition().duration(400).attr('opacity', 0.12);
    }, 2500);
}

// 显示节点详情。
function showNodeDetail(d, nodes, links) {
    if (ontoGraphViewMode === '3d' && ontoThreeState) ontoThreeState.selectedId = d.id;

    const popup = document.getElementById('ontoNodePopup');
    const badge = document.getElementById('ontoPopupBadge');
    const title = document.getElementById('ontoPopupTitle');
    const body  = document.getElementById('ontoPopupBody');

    const cfg = ONTO_COLORS[d.category] || ONTO_COLORS.entity;
    badge.textContent = ONTO_CATEGORY_LABELS[d.category] || d.category;
    badge.style.cssText = `background:${cfg.fill}22;color:${cfg.fill};border:1px solid ${cfg.fill}66`;
    title.textContent = d.label;

    // 收集相连节点。
    const connected = [];
    if (links) {
        links.forEach(l => {
            const src = l.source.id || l.source;
            const tgt = l.target.id || l.target;
            if (src === d.id) connected.push({ label: l.label, direction: '→', name: (l.target.label || l.target) });
            else if (tgt === d.id) connected.push({ label: l.label, direction: '←', name: (l.source.label || l.source) });
        });
    }

    let html = '';
    if (d.description) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">描述</div>
            <div class="onto-popup-desc">${d.description}</div>
        </div>`;
    }
    if (d.tables && d.tables.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">关联表</div>
            <div class="onto-popup-tags">${d.tables.map(t=>`<span class="onto-tag">${t}</span>`).join('')}</div>
        </div>`;
    }
    if (d.attributes && d.attributes.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">属性</div>
            <div class="onto-popup-tags">${d.attributes.map(a=>`<span class="onto-tag">${a}</span>`).join('')}</div>
        </div>`;
    }
    if (connected.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">关联节点 (${connected.length})</div>
            <div class="onto-popup-tags">${connected.map(c=>`<span class="onto-tag">${c.direction} ${c.label} ${c.name}</span>`).join('')}</div>
        </div>`;
    }
    if (d.governance_issues && d.governance_issues.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">治理问题</div>
            <div class="onto-popup-tags">${d.governance_issues.map(g=>`<span class="onto-tag issue">${g}</span>`).join('')}</div>
        </div>`;
    }
    body.innerHTML = html || '<div class="onto-popup-desc" style="color:#6e7681">暂无详情</div>';

    popup.style.display = '';

    // 在 2D 视图中同步高亮选中节点。
    if (ontoGraphViewMode === '2d' && document.querySelector('.onto-node')) {
        d3.selectAll('.onto-node').each(function(nd) {
            const active = nd.id === d.id;
            d3.select(this).select('.onto-node-circle')
                .transition().duration(200)
                .attr('filter', active ? 'url(#onto-glow-strong)' : 'url(#onto-glow)')
                .attr('stroke-width', active ? 4 : 2)
                .attr('opacity', active ? 1 : 0.55);
        });
    }
}

function closeNodeDetail() {
    document.getElementById('ontoNodePopup').style.display = 'none';
    if (ontoThreeState) ontoThreeState.selectedId = null;
    if (ontoGraphViewMode === '2d' && document.querySelector('.onto-node')) {
        d3.selectAll('.onto-node .onto-node-circle')
            .transition().duration(200).attr('stroke-width', 2).attr('opacity', 1).attr('filter','url(#onto-glow)');
    }
}

// 加载本体演示数据。
function loadOntologyDemo() {
    showOntologyLoading('正在加载演示数据...');
    let progress = 0;
    const steps = ['解析本体...', '构建关系...', '生成洞察...', '完成渲染...'];
    let si = 0;
    const t = setInterval(() => {
        progress = Math.min(progress + 5, 95);
        document.getElementById('ontoAiProgressBar').style.width = progress + '%';
        if (si < steps.length && progress >= (si + 1) * 20) {
            document.getElementById('ontoAiText').textContent = steps[si++];
        }
    }, 60);
    setTimeout(() => {
        clearInterval(t);
        document.getElementById('ontoAiProgressBar').style.width = '100%';
        setTimeout(() => {
            hideOntologyLoading();
            renderOntologyGraph(DEMO_ONTOLOGY, true);
            showOntoToast('已生成本体示例：12 个概念、14 条关系、5 条洞察');
        }, 300);
    }, 1800);
}

// 启动本体抽取。
function startOntologyExtract() {
    if (!ontoSelectedDbId) {
        showOntoToast('请先选择要解析的数据库', true);
        return;
    }
    const dbIds = [ontoSelectedDbId];
    showOntologyLoading('AI 正在抽取本体...');

    let progress2 = 0;
    const pi2 = setInterval(() => {
        progress2 = Math.min(progress2 + 2, 88);
        document.getElementById('ontoAiProgressBar').style.width = progress2 + '%';
    }, 300);

    fetchWithAuth(`${API_BASE}/api/v1/ontology/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databases: dbIds }),
    }).then(async res => {
        clearInterval(pi2);
        if (res.status === 401) {
            hideOntologyLoading();
            return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop();
            for (const part of parts) {
                const lines = part.split('\n');
                let evType = '', evData = '';
                for (const line of lines) {
                    if (line.startsWith('event:')) evType = line.slice(6).trim();
                    if (line.startsWith('data:')) evData = line.slice(5).trim();
                }
                if (!evType || !evData) continue;
                try { const d = JSON.parse(evData); ontoHandleSSE(evType, d); } catch { /* non-JSON SSE event, skip */ }
            }
        }
        hideOntologyLoading();
    }).catch(err => {
        clearInterval(pi2);
        hideOntologyLoading();
        showOntoToast('抽取失败：' + err.message, true);
    });
}

function ontoHandleSSE(type, data) {
    switch (type) {
        case 'onto-start':
        case 'onto-thinking':
            document.getElementById('ontoAiText').textContent = data.message || 'AI 处理中...';
            break;
        case 'answer':
            document.getElementById('ontoAiProgressBar').style.width = '100%';
            setTimeout(() => {
                hideOntologyLoading();
                const payload = {
                    concepts: [],
                    relations: [],
                    insights: []
                };
                renderOntologyGraph(payload, true);
                const resultEl = document.getElementById('ontoQueryResult');
                if (resultEl) {
                    let answer = data.text || '';
                    answer = escapeHtml(answer).replace(/\?([^?]+)\?/g, '<span class="onto-highlight-badge">$1</span>');
                    resultEl.innerHTML = answer;
                }
                showOntoToast('本体抽取完成');
            }, 400);
            break;
        case 'onto-result':
            document.getElementById('ontoAiProgressBar').style.width = '100%';
            setTimeout(() => {
                hideOntologyLoading();
                renderOntologyGraph(data, true);
                showOntoToast(`已生成本体：${(data.concepts||[]).length} 个概念，${(data.relations||[]).length} 条关系`);
            }, 400);
            break;
        case 'onto-error':
            hideOntologyLoading();
            showOntoToast('错误：' + (data.message || '未知错误'), true);
            break;
        case 'onto-done':
            hideOntologyLoading();
            break;
    }
}

// 清空本体视图。
function clearOntology() {
    if (ontoSimulation) { ontoSimulation.stop(); ontoSimulation = null; }
    disposeOntologyGraph3D();
    ontoData = null;
    d3.select('#ontoSvg').selectAll('*').remove();
    const svgEl = document.getElementById('ontoSvg');
    if (svgEl) svgEl.style.display = '';
    const g3 = document.getElementById('ontoGraph3d');
    if (g3) g3.style.display = 'none';
    const viewToggle = document.getElementById('ontoViewToggle');
    const viewSep = document.getElementById('ontoViewToggleSep');
    if (viewToggle) viewToggle.style.display = 'none';
    if (viewSep) viewSep.style.display = 'none';
    document.getElementById('ontoWelcome').style.display = '';
    document.getElementById('ontoQueryBar').classList.add('onto-query-disabled');
    document.getElementById('ontoClearBtn').style.display = 'none';
    document.getElementById('ontoNodePopup').style.display = 'none';
    document.getElementById('ontoQueryResult').style.display = 'none';
    document.getElementById('ontoInsightBody').innerHTML = '<div class="onto-insight-placeholder"><span>无</span><p>请先通过 AI 抽取或加载本体数据</p></div>';
    ['ontoStatConcepts','ontoStatRelations','ontoStatRisks'].forEach(id => { document.getElementById(id).textContent='0'; });
}

// 执行本体问答查询。
async function doOntologyQuery() {
    const input = document.getElementById('ontoQueryInput');
    const query = input.value.trim();
    if (!query) return;
    if (!ontoData) { showOntoToast('请先加载本体数据', true); return; }

    const btn = document.getElementById('ontoQueryBtn');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> 查询中...';

    const resultEl = document.getElementById('ontoQueryResult');
    resultEl.style.display = '';
    resultEl.innerHTML = '<span style="color:#667eea">AI 正在分析本体...</span>';

    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/ontology/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, ontology: ontoData }),
        });
        if (res.status === 401) return;
        const data = await res.json();
        if (data.success) {
            // 根据命中的概念做高亮。
            if (data.highlighted && data.highlighted.length) {
                const set = new Set(data.highlighted);
                d3.selectAll('.onto-node').each(function(d) {
                    const active = set.has(d.id);
                    d3.select(this).select('.onto-node-circle')
                        .transition().duration(300)
                        .attr('filter', active ? 'url(#onto-glow-strong)' : 'url(#onto-glow)')
                        .attr('stroke-width', active ? 4 : 2).attr('opacity', active ? 1 : 0.4);
                });
                setTimeout(() => {
                    d3.selectAll('.onto-node .onto-node-circle')
                        .transition().duration(400).attr('stroke-width', 2).attr('opacity', 1).attr('filter','url(#onto-glow)');
                }, 4000);
            }
            // 渲染返回答案。
            let answer = data.answer || '';
            answer = escapeHtml(answer).replace(/\?([^?]+)\?/g, '<span class="onto-highlight-badge">$1</span>');
            resultEl.innerHTML = answer;
        } else {
            resultEl.innerHTML = `<span style="color:#E17055">错误：${escapeHtml(data.message)}</span>`;
        }
    } catch (e) {
        resultEl.innerHTML = `<span style="color:#E17055">错误：${escapeHtml(e.message)}</span>`;
    }
    btn.disabled = false;
    btn.innerHTML = '<span>⌕</span> 查询本体';
}

// 展开或收起洞察面板。
function toggleInsightPanel() {
    ontoInsightExpanded = !ontoInsightExpanded;
    document.getElementById('ontoInsightPanel').classList.toggle('collapsed', !ontoInsightExpanded);
}

// 显示本体加载遮罩。
function showOntologyLoading(text) {
    const ov = document.getElementById('ontoAiOverlay');
    document.getElementById('ontoAiText').textContent = text || 'AI 处理中...';
    document.getElementById('ontoAiProgressBar').style.width = '0%';
    ov.style.display = 'flex';
}

function hideOntologyLoading() {
    document.getElementById('ontoAiOverlay').style.display = 'none';
}

// ---- Toast ----
let ontoToastTimer = null;
function showOntoToast(msg, isError) {
    if (ontoToastTimer) clearTimeout(ontoToastTimer);
    const old = document.querySelector('.onto-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'onto-toast';
    el.style.cssText = isError ? 'border-color:#fed7d7;color:#c53030' : '';
    el.textContent = msg;
    document.body.appendChild(el);
    ontoToastTimer = setTimeout(() => el.remove(), 3500);
}

// 数据库类型图标。
const DB_TYPE_ICONS = {
    mysql: '🛢️', postgresql: '🐘', oracle: '🏛️', mssql: '🪟', mongodb: '🍃',
    dm: '🔶', sqlite: '📄', duckdb: '🦆', clickhouse: '📊', neo4j: '🕸️',
};

function getDbIcon(type) {
    return DB_TYPE_ICONS[(type||'').toLowerCase()] || '🗄️';
}

// 切换本体数据库选择器。
function toggleDbPicker(e) {
    e.stopPropagation();
    const dd = document.getElementById('ontoDbDropdown');
    const btn = document.getElementById('ontoDbBtn');
    const isOpen = dd.classList.contains('open');
    dd.classList.toggle('open', !isOpen);
    btn.classList.toggle('active', !isOpen);
}

// 选择本体数据库。
function selectOntologyDb(dbId, dbName, dbType) {
    ontoSelectedDbId = dbId;
    const textEl = document.getElementById('ontoDbBtnText');
    textEl.textContent = `${getDbIcon(dbType)} ${dbName}`;
    textEl.classList.remove('placeholder');
    // 更新选中状态。
    document.querySelectorAll('.onto-db-option').forEach(el => {
        const isSelected = el.dataset.dbId === dbId;
        el.classList.toggle('selected', isSelected);
        const check = el.querySelector('.onto-db-option-check');
        if (check) check.style.display = isSelected ? '' : 'none';
    });
    // 收起下拉框。
    document.getElementById('ontoDbDropdown').classList.remove('open');
    document.getElementById('ontoDbBtn').classList.remove('active');
}

// 点击页面空白处时收起数据库下拉框。
document.addEventListener('click', () => {
    const dd = document.getElementById('ontoDbDropdown');
    const btn = document.getElementById('ontoDbBtn');
    if (dd) dd.classList.remove('open');
    if (btn) btn.classList.remove('active');
    const ldd = document.getElementById('lineageDbDropdown');
    const lbtn = document.getElementById('lineageDbBtn');
    if (ldd) ldd.classList.remove('open');
    if (lbtn) lbtn.classList.remove('active');
});

// 初始化本体标签页。
function initOntologyTab() {
    const dropdown = document.getElementById('ontoDbDropdown');
    const emptyEl  = document.getElementById('ontoDbDropdownEmpty');
    if (!dropdown) return;

    // 清空旧的数据库选项。
    dropdown.querySelectorAll('.onto-db-option').forEach(el => el.remove());

    if (databases.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        databases.forEach(db => {
            const item = document.createElement('div');
            item.className = 'onto-db-option';
            item.dataset.dbId = db.id;
            const isSelected = db.id === ontoSelectedDbId;
            if (isSelected) item.classList.add('selected');
            item.innerHTML = `
                <span class="onto-db-option-icon">${getDbIcon(db.type)}</span>
                <span class="onto-db-option-info">
                    <span class="onto-db-option-name">${db.name}</span>
                    <span class="onto-db-option-type">${db.type || 'unknown'}</span>
                </span>
                <span class="onto-db-option-check" style="display:${isSelected ? '' : 'none'}">?</span>`;
            item.onclick = (e) => {
                e.stopPropagation();
                selectOntologyDb(db.id, db.name, db.type);
            };
            dropdown.appendChild(item);
        });
        // 没有选中时显示占位文本。
        if (!ontoSelectedDbId) {
            const textEl = document.getElementById('ontoDbBtnText');
            if (textEl) { textEl.textContent = '请选择数据库'; textEl.classList.add('placeholder'); }
        }
    }

    // 监听窗口缩放，重新渲染本体图。
    if (!window._ontoResizeRegistered) {
        window._ontoResizeRegistered = true;
        window.addEventListener('resize', () => {
            if (ontoData) renderOntologyGraph(ontoData, false);
        });
    }
}

// 血缘分析状态。
let lineageSelectedDbId = null;
let lineageSimulation = null;
let lineageFocusTableId = null;
let lineageParticleRafId = null;

function lineageStopParticleLoop() {
    if (lineageParticleRafId != null) {
        cancelAnimationFrame(lineageParticleRafId);
        lineageParticleRafId = null;
    }
}

function lineageQuadBezierPoint(p0, p1, p2, t) {
    const u = 1 - t;
    return {
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
    };
}

function lineageShortTableName(full) {
    if (!full) return '';
    const s = String(full);
    const i = s.lastIndexOf('.');
    return i >= 0 ? s.slice(i + 1) : s;
}

function toggleLineageDbPicker(e) {
    e.stopPropagation();
    const dd = document.getElementById('lineageDbDropdown');
    const btn = document.getElementById('lineageDbBtn');
    if (!dd || !btn) return;
    const isOpen = dd.classList.contains('open');
    dd.classList.toggle('open', !isOpen);
    btn.classList.toggle('active', !isOpen);
}

function selectLineageDb(dbId, dbName, dbType) {
    lineageSelectedDbId = dbId;
    const textEl = document.getElementById('lineageDbBtnText');
    if (textEl) {
        textEl.textContent = `${getDbIcon(dbType)} ${dbName}`;
        textEl.classList.remove('placeholder');
    }
    document.querySelectorAll('.lineage-db-option').forEach(el => {
        const sel = el.dataset.dbId === dbId;
        el.classList.toggle('selected', sel);
        const c = el.querySelector('.lineage-db-option-check');
        if (c) c.style.display = sel ? '' : 'none';
    });
    const dd = document.getElementById('lineageDbDropdown');
    const btn = document.getElementById('lineageDbBtn');
    if (dd) dd.classList.remove('open');
    if (btn) btn.classList.remove('active');
}

function initLineageTab() {
    const dropdown = document.getElementById('lineageDbDropdown');
    const emptyEl = document.getElementById('lineageDbDropdownEmpty');
    if (!dropdown) return;
    dropdown.querySelectorAll('.lineage-db-option').forEach(el => el.remove());
    if (databases.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        databases.forEach(db => {
            const item = document.createElement('div');
            item.className = 'lineage-db-option';
            item.dataset.dbId = db.id;
            const isSelected = db.id === lineageSelectedDbId;
            if (isSelected) item.classList.add('selected');
            item.innerHTML = `
                <span>${getDbIcon(db.type)}</span>
                <span style="flex:1;min-width:0"><strong>${escapeHtml(db.name)}</strong><br><span style="color:#a0aec0;font-size:11px">${escapeHtml(db.type || '')}</span></span>
                <span class="lineage-db-option-check" style="display:${isSelected ? '' : 'none'}">?</span>`;
            item.onclick = (ev) => {
                ev.stopPropagation();
                selectLineageDb(db.id, db.name, db.type);
            };
            dropdown.appendChild(item);
        });
        if (!lineageSelectedDbId) {
            const te = document.getElementById('lineageDbBtnText');
            if (te) { te.textContent = '请选择数据库'; te.classList.add('placeholder'); }
        }
    }
    if (!window._lineageResizeRegistered) {
        window._lineageResizeRegistered = true;
        window.addEventListener('resize', () => {
            if (lineageSelectedDbId && window.lineageLastPayload) {
                renderLineageGraph(window.lineageLastPayload);
            }
        });
    }
}

function lineageDirectedLinksFromEdges(edges) {
    return (edges || []).map(e => {
        if (e.kind === 'etl') {
            return { s: e.fromTable, t: e.toTable, kind: 'etl', fromColumn: e.fromColumn, toColumn: e.toColumn };
        }
        return { s: e.toTable, t: e.fromTable, kind: 'fk', fromColumn: e.fromColumn, toColumn: e.toColumn };
    });
}

function lineageNeighborsUp(tableId, dlinks) {
    const out = new Set();
    dlinks.forEach(l => {
        if (l.t === tableId) out.add(l.s);
    });
    return out;
}

function lineageNeighborsDown(tableId, dlinks) {
    const out = new Set();
    dlinks.forEach(l => {
        if (l.s === tableId) out.add(l.t);
    });
    return out;
}

function lineageExpandedUpstreamIds(focusId, dlinks) {
    const up = lineageNeighborsUp(focusId, dlinks);
    const down = lineageNeighborsDown(focusId, dlinks);
    const expanded = new Set(up);
    down.forEach(c => {
        lineageNeighborsUp(c, dlinks).forEach(p => {
            if (p !== focusId) expanded.add(p);
        });
    });
    return expanded;
}

function lineageDownstreamBfsIds(focusId, dlinks) {
    const seen = new Set();
    const q = [focusId];
    seen.add(focusId);
    while (q.length) {
        const n = q.shift();
        dlinks.forEach(l => {
            if (l.s === n && !seen.has(l.t)) {
                seen.add(l.t);
                q.push(l.t);
            }
        });
    }
    seen.delete(focusId);
    return seen;
}

// 将 schema.table 拆成可换行标签。
function lineageTableLabelLines(full) {
    const s = String(full || '');
    if (!s) return [''];
    const max1 = 26;
    if (s.length <= max1) return [s];
    const dot = s.lastIndexOf('.');
    if (dot > 0) {
        const schema = s.slice(0, dot + 1);
        const table = s.slice(dot + 1);
        if (schema.length <= max1 && table.length <= max1) return [schema, table];
    }
    const lines = [];
    for (let i = 0; i < s.length; i += max1) lines.push(s.slice(i, i + max1));
    return lines;
}

// 测量血缘节点尺寸。
function lineageMeasureNodeBoxes(svg, nodes) {
    const tmp = svg.append('text')
        .attr('class', 'lineage-node-label lineage-node-label-measure')
        .attr('visibility', 'hidden')
        .attr('x', -9999)
        .attr('y', -9999);
    const lineHeight = 14;
    const padX = 12;
    const padY = 8;
    const maxLabelWidth = 320;
    const minW = 80;
    nodes.forEach(d => {
        d._lines = lineageTableLabelLines(d.full || d.id);
        let maxW = 0;
        d._lines.forEach(line => {
            tmp.text(line);
            try {
                const bb = tmp.node().getBBox();
                maxW = Math.max(maxW, bb.width);
            } catch (e) {
                maxW = Math.max(maxW, line.length * 7);
            }
        });
        d._nw = Math.min(maxLabelWidth, Math.max(minW, maxW + padX * 2));
        d._nh = d._lines.length * lineHeight + padY * 2;
        d.lw = d._nw / 2;
        d.lh = d._nh / 2;
    });
    tmp.remove();
}

function lineageLineEndpoints(sx, sy, tx, ty, offS, offT) {
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { x1: sx, y1: sy, x2: tx, y2: ty };
    const ux = dx / len;
    const uy = dy / len;
    return {
        x1: sx + ux * offS,
        y1: sy + uy * offS,
        x2: tx - ux * offT,
        y2: ty - uy * offT
    };
}

// 生成血缘连线曲线。
function lineageLinkCurveGeom(d, bias) {
    const offS = Math.hypot(d.source.lw, d.source.lh) + 4;
    const offT = Math.hypot(d.target.lw, d.target.lh) + 4;
    const { x1, y1, x2, y2 } = lineageLineEndpoints(
        d.source.x, d.source.y, d.target.x, d.target.y, offS, offT
    );
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const curve = 0.24 * len + (bias || 0);
    const cx = mx + px * curve;
    const cy = my + py * curve;
    return {
        x1, y1, cx, cy, x2, y2,
        dPath: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`
    };
}

// 按焦点表高亮血缘图。
function applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount) {
    const dlinks = lineageDirectedLinksFromEdges(edges);
    const base = `${tables.length} 张表 / ${edgeCount} 条关系`;
    if (!statsEl) return;
    if (!lineageFocusTableId) {
        statsEl.textContent = `${base}，未选择焦点表`;
        nodeSel.selectAll('.lineage-node-shape').attr('opacity', 1).attr('stroke-width', 2).attr('stroke', 'url(#lineage-node-stroke-grad)');
        linkItems.selectAll('path').attr('opacity', 1);
        linkItems.selectAll('.lineage-particle').attr('opacity', 1);
        return;
    }
    const focus = lineageFocusTableId;
    const up = lineageExpandedUpstreamIds(focus, dlinks);
    const down = lineageDownstreamBfsIds(focus, dlinks);
    const keep = new Set([focus, ...up, ...down]);
    const upStr = [...up].sort().join(', ') || '无';
    const downStr = [...down].sort().join(', ') || '无';
    statsEl.innerHTML = `${escapeHtml(base)}，焦点表 <code style="color:#67e8f9">${escapeHtml(focus)}</code>，上游：${escapeHtml(upStr)}，下游：${escapeHtml(downStr)}`;

    nodeSel.selectAll('.lineage-node-shape')
        .attr('opacity', d => (keep.has(d.id) ? 1 : 0.15))
        .attr('stroke-width', d => (d.id === focus ? 3.5 : 2))
        .attr('stroke', d => (d.id === focus ? '#fbbf24' : 'url(#lineage-node-stroke-grad)'));

    const linkOp = d => {
        const sid = d.source.id;
        const tid = d.target.id;
        return keep.has(sid) && keep.has(tid) ? 1 : 0.12;
    };
    linkItems.selectAll('path').attr('opacity', linkOp);
    linkItems.selectAll('.lineage-particle').attr('opacity', linkOp);
}

// 加载血缘图数据。
async function loadLineageGraph() {
    if (!lineageSelectedDbId) {
        showOntoToast('请先选择数据库', true);
        return;
    }
    lineageFocusTableId = null;
    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/databases/${lineageSelectedDbId}/lineage`);
        const data = await res.json();
        if (!data.success) {
            showOntoToast(data.message || '加载失败', true);
            return;
        }
        window.lineageLastPayload = data;
        renderLineageGraph(data);
        if (data.message) showOntoToast(data.message);
    } catch (err) {
        showOntoToast('加载失败：' + (err.message || String(err)), true);
    }
}

// 渲染血缘图。
function renderLineageGraph(data) {
    const svgEl = document.getElementById('lineageSvg');
    const ph = document.getElementById('lineagePlaceholder');
    const statsEl = document.getElementById('lineageStats');
    const listEl = document.getElementById('lineageEdgeList');
    if (!svgEl || !data) return;

    const tables = data.tables || [];
    const edges = data.edges || [];
    const edgeCount = data.edge_count != null ? data.edge_count : edges.length;

    if (listEl) {
        if (edges.length === 0) {
            listEl.innerHTML = '<div style="color:#a0aec0;padding:12px">暂无血缘关系</div>';
        } else {
            listEl.innerHTML = edges.map(e => {
                const ft = escapeHtml(e.fromTable || '');
                const fc = escapeHtml(e.fromColumn || '');
                const tt = escapeHtml(e.toTable || '');
                const tc = escapeHtml(e.toColumn || '');
                const tag = e.kind === 'etl' ? ' <span style="color:#f6ad55;font-size:11px">ETL</span>' : '';
                return `<div class="lineage-edge-row"><code>${ft}</code>.<code>${fc}</code> → <code>${tt}</code>.<code>${tc}</code>${tag}</div>`;
            }).join('');
        }
    }

    const nodeById = new Map();
    tables.forEach(t => nodeById.set(t, { id: t, label: lineageShortTableName(t), full: t }));
    edges.forEach(e => {
        if (!nodeById.has(e.fromTable)) nodeById.set(e.fromTable, { id: e.fromTable, label: lineageShortTableName(e.fromTable), full: e.fromTable });
        if (!nodeById.has(e.toTable)) nodeById.set(e.toTable, { id: e.toTable, label: lineageShortTableName(e.toTable), full: e.toTable });
    });
    const nodes = Array.from(nodeById.values());
    const links = edges.map(e => {
        if (e.kind === 'etl') {
            return {
                source: e.fromTable,
                target: e.toTable,
                fromColumn: e.fromColumn,
                toColumn: e.toColumn,
                kind: 'etl'
            };
        }
        return {
            source: e.toTable,
            target: e.fromTable,
            fromColumn: e.fromColumn,
            toColumn: e.toColumn,
            kind: 'fk'
        };
    });

    // 没有节点时显示空状态。
    if (nodes.length === 0) {
        lineageStopParticleLoop();
        if (ph) ph.style.display = '';
        d3.select('#lineageSvg').selectAll('*').remove();
        if (lineageSimulation) { lineageSimulation.stop(); lineageSimulation = null; }
        return;
    }
    if (ph) ph.style.display = 'none';

    const wrap = document.getElementById('lineageChartWrap');
    const W = (wrap && wrap.clientWidth) || svgEl.parentElement.clientWidth || 600;
    const H = (wrap && wrap.clientHeight) || svgEl.parentElement.clientHeight || 400;

    lineageStopParticleLoop();
    const svg = d3.select('#lineageSvg').attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const nodeFillGrad = defs.append('linearGradient')
        .attr('id', 'lineage-node-fill-grad')
        .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
    nodeFillGrad.append('stop').attr('offset', '0%').attr('stop-color', '#1e3a5f');
    nodeFillGrad.append('stop').attr('offset', '55%').attr('stop-color', '#312e81');
    nodeFillGrad.append('stop').attr('offset', '100%').attr('stop-color', '#4c1d95');

    const nodeStrokeGrad = defs.append('linearGradient')
        .attr('id', 'lineage-node-stroke-grad')
        .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
    nodeStrokeGrad.append('stop').attr('offset', '0%').attr('stop-color', '#22d3ee');
    nodeStrokeGrad.append('stop').attr('offset', '100%').attr('stop-color', '#a78bfa');

    const arrowGrad = defs.append('linearGradient')
        .attr('id', 'lineage-arrow-grad')
        .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '0%');
    arrowGrad.append('stop').attr('offset', '0%').attr('stop-color', '#67e8f9');
    arrowGrad.append('stop').attr('offset', '100%').attr('stop-color', '#c4b5fd');

    const m = defs.append('marker')
        .attr('id', 'lineage-arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 9)
        .attr('refY', 0)
        .attr('markerWidth', 7)
        .attr('markerHeight', 7)
        .attr('orient', 'auto');
    m.append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'url(#lineage-arrow-grad)');

    const mainG = svg.append('g').attr('class', 'lineage-main-g');
    const zoom = d3.zoom().scaleExtent([0.2, 4]).on('zoom', ev => mainG.attr('transform', ev.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    const nodeMap = {};
    nodes.forEach(n => { n.x = W / 2 + (Math.random() - 0.5) * 200; n.y = H / 2 + (Math.random() - 0.5) * 200; nodeMap[n.id] = n; });
    const linkData = links.filter(l => nodeMap[l.source] && nodeMap[l.target]).map(l => ({
        source: nodeMap[l.source],
        target: nodeMap[l.target],
        fromColumn: l.fromColumn,
        toColumn: l.toColumn,
        kind: l.kind || 'fk'
    }));

    const pairCount = new Map();
    linkData.forEach(d => {
        const key = `${d.source.id}\0${d.target.id}`;
        const n = pairCount.get(key) || 0;
        pairCount.set(key, n + 1);
        d._curveBias = (n % 2 === 0 ? 1 : -1) * (Math.floor(n / 2) + 1) * 14;
    });

    lineageMeasureNodeBoxes(svg, nodes);

    if (lineageSimulation) lineageSimulation.stop();
    lineageSimulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(linkData).id(d => d.id).distance(d => (d.kind === 'etl' ? 150 : 125)))
        .force('charge', d3.forceManyBody().strength(-420))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collision', d3.forceCollide().radius(d => Math.hypot(d.lw, d.lh) + 22));

    const linkG = mainG.append('g').attr('class', 'lineage-links-layer');
    const linkItems = linkG.selectAll('g.lineage-link-item')
        .data(linkData)
        .enter()
        .append('g')
        .attr('class', d => `lineage-link-item ${d.kind === 'etl' ? 'lineage-link-item-etl' : 'lineage-link-item-fk'}`);

    linkItems.each(function (d) {
        const g = d3.select(this);
        const baseKind = d.kind === 'etl' ? 'lineage-link-kind-etl' : 'lineage-link-kind-fk';
        g.append('path')
            .attr('class', `lineage-link-base lineage-link-path ${baseKind}`)
            .attr('fill', 'none')
            .attr('marker-end', 'url(#lineage-arrow)');
        const flowClass = d.kind === 'etl' ? 'lineage-link-flow lineage-link-flow-etl' : 'lineage-link-flow lineage-link-flow-fk';
        g.append('path')
            .attr('class', flowClass)
            .attr('fill', 'none')
            .attr('pointer-events', 'none');
        const radii = [3.4, 2.6, 2.2];
        radii.forEach((r, i) => {
            g.append('circle')
                .attr('class', `lineage-particle lineage-particle-${i}`)
                .attr('r', r)
                .attr('pointer-events', 'none');
        });
    });

    const nodeG = mainG.append('g').attr('class', 'lineage-nodes-layer');
    const nodeSel = nodeG.selectAll('g.lineage-node').data(nodes).enter().append('g')
        .attr('class', 'lineage-node')
        .style('cursor', 'grab')
        .call(d3.drag()
            .on('start', (ev, d) => { if (!ev.active) lineageSimulation.alphaTarget(0.35).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
            .on('end', (ev, d) => { if (!ev.active) lineageSimulation.alphaTarget(0); d.fx = null; d.fy = null; })
        );

    const inner = nodeSel.append('g').attr('class', 'lineage-node-inner');
    const hitPad = 10;
    inner.append('rect')
        .attr('class', 'lineage-node-hit')
        .attr('x', d => -d._nw / 2 - hitPad)
        .attr('y', d => -d._nh / 2 - hitPad)
        .attr('width', d => d._nw + hitPad * 2)
        .attr('height', d => d._nh + hitPad * 2)
        .attr('rx', 12)
        .attr('ry', 12)
        .attr('fill', 'transparent')
        .attr('stroke', 'none')
        .attr('pointer-events', 'all');
    inner.append('rect')
        .attr('class', 'lineage-node-shape')
        .attr('x', d => -d._nw / 2)
        .attr('y', d => -d._nh / 2)
        .attr('width', d => d._nw)
        .attr('height', d => d._nh)
        .attr('rx', 10)
        .attr('ry', 10)
        .attr('fill', 'url(#lineage-node-fill-grad)')
        .attr('stroke', 'url(#lineage-node-stroke-grad)')
        .attr('stroke-width', 2);

    inner.append('text')
        .attr('class', 'lineage-node-label')
        .attr('text-anchor', 'middle')
        .attr('pointer-events', 'none')
        .each(function (d) {
            const el = d3.select(this);
            const lh = 14;
            const lines = d._lines || [d.full || d.id];
            lines.forEach((line, i) => {
                el.append('tspan')
                    .attr('x', 0)
                    .attr('dy', i === 0 ? `${-(lines.length - 1) * lh / 2}` : `${lh}`)
                    .text(line);
            });
        });

    nodeSel.append('title').text(d => d.full || d.id);

    nodeSel.on('click', (ev, d) => {
        ev.stopPropagation();
        lineageFocusTableId = d.id;
        applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount);
    });

    svg.on('dblclick', (ev) => {
        if (ev.target && ev.target.id === 'lineageSvg') {
            lineageFocusTableId = null;
            applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount);
        }
    });

    applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount);

    lineageSimulation.on('tick', () => {
        linkItems.each(function (d) {
            const geom = lineageLinkCurveGeom(d, d._curveBias || 0);
            d._curve = geom;
            d3.select(this).selectAll('path').attr('d', geom.dPath);
        });
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    const phases = [0, 0.33, 0.66];
    const stepParticles = () => {
        const tBase = (performance.now() / 2200) % 1;
        linkItems.each(function (d) {
            const c = d._curve;
            if (!c) return;
            const p0 = { x: c.x1, y: c.y1 };
            const p1 = { x: c.cx, y: c.cy };
            const p2 = { x: c.x2, y: c.y2 };
            const g = d3.select(this);
            g.selectAll('.lineage-particle').each(function (_, i) {
                const t = (tBase + phases[i % phases.length]) % 1;
                const pt = lineageQuadBezierPoint(p0, p1, p2, t);
                d3.select(this).attr('cx', pt.x).attr('cy', pt.y);
            });
        });
        lineageParticleRafId = requestAnimationFrame(stepParticles);
    };
    lineageParticleRafId = requestAnimationFrame(stepParticles);
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('govApiHelpModal')?.style.display !== 'none') {
        closeGovApiHelp();
    }
});
