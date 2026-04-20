const app = {
    currentEditor: null,
    currentFilename: '未命名文档',
    spreadsheet: null,
    luckysheet: null,
    quill: null,
    mindmapData: null,
    mindmapSvg: null,
    pptPresentation: null,
    mxgraphEditor: null,
    currentSlideIndex: 0,
    slides: [],

    init() {
        this.setupFileInput();
        console.log('文档编辑器初始化完成');
    },

    setupFileInput() {
        const fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadFile(file);
            }
        });
    },

    switchEditor(type, action = 'new') {
        // 隐藏所有编辑器
        document.querySelectorAll('.editor-area').forEach(area => {
            area.classList.remove('active');
        });

        // 更新当前编辑器类型
        this.currentEditor = type;

        // 显示对应编辑器
        if (type === 'excel') {
            document.getElementById('excel-area').classList.add('active');
            if (action === 'new' && !this.spreadsheet) {
                this.initSpreadsheet();
            }
            this.currentFilename = '未命名表格.xlsx';
        } else if (type === 'excel-lucky') {
            document.getElementById('excel-lucky-area').classList.add('active');
            if (action === 'new' && !this.luckysheet) {
                this.initLuckysheet();
            }
            this.currentFilename = '未命名表格.xlsx';
        } else if (type === 'word') {
            document.getElementById('word-area').classList.add('active');
            if (action === 'new' && !this.quill) {
                this.initWordEditor();
            }
            this.currentFilename = '未命名文档.docx';
        } else if (type === 'ppt') {
            document.getElementById('ppt-area').classList.add('active');
            if (action === 'new') {
                this.initPPTEditor();
            }
            this.currentFilename = '未命名演示文稿.pptx';
        } else if (type === 'mindmap') {
            document.getElementById('mindmap-area').classList.add('active');
            if (action === 'new') {
                this.initMindMap();
            }
            this.currentFilename = '未命名思维导图.json';
        } else if (type === 'diagram') {
            document.getElementById('diagram-area').classList.add('active');
            if (action === 'new') {
                this.initDiagram();
            }
            this.currentFilename = '未命名图表.vsdx';
        }

        document.getElementById('filename').textContent = this.currentFilename;
    },

    // Excel 编辑器 (x-spreadsheet)
    initSpreadsheet() {
        const container = document.getElementById('spreadsheet-container');
        container.innerHTML = '';
        
        this.spreadsheet = x_spreadsheet(container, {
            mode: 'edit',
            showToolbar: true,
            showGrid: true,
            showContextmenu: true,
            view: {
                height: () => container.clientHeight,
                width: () => container.clientWidth,
            },
            row: {
                len: 100,
                height: 25,
            },
            col: {
                len: 26,
                width: 100,
                indexWidth: 60,
                minWidth: 60,
            },
        });
    },

    // Excel 编辑器 (Luckysheet)
    initLuckysheet() {
        const container = document.getElementById('luckysheet-container');
        container.innerHTML = '';
        
        if (typeof luckysheet !== 'undefined') {
            luckysheet.create({
                container: 'luckysheet-container',
                lang: 'zh',
                showinfobar: false,
                data: [{
                    name: 'Sheet1',
                    color: '',
                    status: 1,
                    order: 0,
                    data: [],
                    config: {},
                    index: 0
                }]
            });
            this.luckysheet = true;
        } else {
            alert('Luckysheet 库未加载，使用 x-spreadsheet 代替');
            this.switchEditor('excel', 'new');
        }
    },

    // Word 编辑器
    initWordEditor() {
        const toolbarOptions = [
            [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
            [{ 'font': [] }],
            [{ 'size': ['small', false, 'large', 'huge'] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'align': [] }],
            [{ 'indent': '-1'}, { 'indent': '+1' }],
            ['link', 'image'],
            ['clean']
        ];

        this.quill = new Quill('#word-editor', {
            theme: 'snow',
            modules: {
                toolbar: toolbarOptions
            },
            placeholder: '开始输入文档内容...'
        });
    },

    // PPT 编辑器
    initPPTEditor() {
        this.pptPresentation = new PptxGenJS();
        this.slides = [];
        this.currentSlideIndex = 0;
        
        // 添加第一张幻灯片
        this.ppt.addSlide();
        
        // 加载第一张幻灯片数据
        setTimeout(() => {
            this.ppt.loadSlideData();
        }, 100);
    },

    ppt: {
        addSlide() {
            const slide = app.pptPresentation.addSlide();
            
            app.slides.push({
                slide: slide,
                title: '新幻灯片',
                content: '',
                titleText: `幻灯片 ${app.slides.length + 1}`
            });
            
            app.currentSlideIndex = app.slides.length - 1;
            app.ppt.updateSlidePreview();
            app.ppt.loadSlideData();
        },

        deleteSlide() {
            if (app.slides.length <= 1) {
                alert('至少需要保留一张幻灯片');
                return;
            }
            
            app.slides.splice(app.currentSlideIndex, 1);
            if (app.currentSlideIndex >= app.slides.length) {
                app.currentSlideIndex = app.slides.length - 1;
            }
            
            app.ppt.updateSlidePreview();
            app.ppt.loadSlideData();
        },

        updateSlidePreview() {
            const preview = document.getElementById('slide-preview');
            preview.innerHTML = '';
            
            app.slides.forEach((slideData, index) => {
                const slideItem = document.createElement('div');
                slideItem.className = 'slide-item';
                if (index === app.currentSlideIndex) {
                    slideItem.classList.add('active');
                }
                slideItem.textContent = slideData.titleText;
                slideItem.onclick = () => {
                    app.currentSlideIndex = index;
                    app.ppt.updateSlidePreview();
                    app.ppt.loadSlideData();
                };
                preview.appendChild(slideItem);
            });
            
            document.getElementById('current-slide-num').textContent = app.currentSlideIndex + 1;
        },

        loadSlideData() {
            const currentSlide = app.slides[app.currentSlideIndex];
            if (currentSlide) {
                const titleInput = document.getElementById('ppt-title');
                const contentInput = document.getElementById('ppt-content');
                if (titleInput && contentInput) {
                    titleInput.value = currentSlide.title || '';
                    contentInput.value = currentSlide.content || '';
                }
            }
        },

        updateCurrentSlide() {
            const title = document.getElementById('ppt-title').value;
            const content = document.getElementById('ppt-content').value;
            
            const currentSlide = app.slides[app.currentSlideIndex];
            if (currentSlide) {
                currentSlide.title = title;
                currentSlide.content = content;
                currentSlide.titleText = title || `幻灯片 ${app.currentSlideIndex + 1}`;
                
                // 更新PptxGenJS幻灯片内容
                const slide = currentSlide.slide;
                
                // 清空现有内容（注：PptxGenJS不直接支持清空，这里重新创建）
                // 添加标题
                if (title) {
                    slide.addText(title, {
                        x: 0.5,
                        y: 0.5,
                        w: 9,
                        h: 1,
                        fontSize: 32,
                        bold: true,
                        color: '363636'
                    });
                }
                
                // 添加内容
                if (content) {
                    slide.addText(content, {
                        x: 0.5,
                        y: 2,
                        w: 9,
                        h: 4,
                        fontSize: 18,
                        color: '666666'
                    });
                }
                
                app.ppt.updateSlidePreview();
                alert('幻灯片已更新');
            }
        }
    },

    // 思维导图 (D3.js实现)
    initMindMap() {
        if (typeof d3 === 'undefined') {
            alert('D3.js 库未加载，无法创建思维导图');
            return;
        }
        
        this.mindmapData = {
            name: '中心主题',
            children: [
                {
                    name: '分支 1',
                    children: [
                        { name: '子节点 1-1' },
                        { name: '子节点 1-2' }
                    ]
                },
                {
                    name: '分支 2',
                    children: [
                        { name: '子节点 2-1' },
                        { name: '子节点 2-2' }
                    ]
                },
                {
                    name: '分支 3',
                    children: [
                        { name: '子节点 3-1' }
                    ]
                }
            ]
        };
        
        this.mindmap.render();
    },

    mindmap: {
        selectedNode: null,
        zoom: null,

        render() {
            const svg = d3.select('#mindmap-container');
            svg.selectAll('*').remove();
            
            const width = document.getElementById('mindmap-area').clientWidth;
            const height = document.getElementById('mindmap-area').clientHeight - 40;
            
            svg.attr('width', width).attr('height', height);
            
            // 添加缩放和平移功能
            const zoom = d3.zoom()
                .scaleExtent([0.5, 3])
                .on('zoom', (event) => {
                    g.attr('transform', event.transform);
                });
            
            svg.call(zoom);
            app.mindmap.zoom = zoom;
            
            const treeLayout = d3.tree().size([height - 100, width - 200]);
            const root = d3.hierarchy(app.mindmapData);
            treeLayout(root);
            
            const g = svg.append('g')
                .attr('transform', 'translate(100, 50)');
            
            // 绘制连线
            const links = g.selectAll('.mindmap-link')
                .data(root.links())
                .enter()
                .append('path')
                .attr('class', 'mindmap-link')
                .attr('d', d3.linkHorizontal()
                    .x(d => d.y)
                    .y(d => d.x));
            
            // 绘制节点
            const nodes = g.selectAll('.mindmap-node')
                .data(root.descendants())
                .enter()
                .append('g')
                .attr('class', 'mindmap-node')
                .attr('transform', d => `translate(${d.y},${d.x})`)
                .style('cursor', 'move');
            
            nodes.append('rect')
                .attr('x', -60)
                .attr('y', -15)
                .attr('width', 120)
                .attr('height', 30)
                .attr('rx', 5)
                .style('fill', d => {
                    if (d === app.mindmap.selectedNode) return '#f39c12';
                    return d.depth === 0 ? '#e74c3c' : d.depth === 1 ? '#3498db' : '#2ecc71';
                })
                .style('stroke', d => d === app.mindmap.selectedNode ? '#d68910' : null);
            
            nodes.append('text')
                .attr('dy', 5)
                .attr('text-anchor', 'middle')
                .text(d => d.data.name)
                .style('pointer-events', 'none');
            
            // 添加拖拽功能
            const dragHandler = d3.drag()
                .on('start', function(event, d) {
                    d3.select(this).raise();
                    app.mindmap.selectedNode = d;
                    d3.select(this).select('rect').style('stroke', '#d68910').style('stroke-width', 3);
                })
                .on('drag', function(event, d) {
                    // 更新节点位置
                    d.x = event.y;
                    d.y = event.x;
                    d3.select(this).attr('transform', `translate(${d.y},${d.x})`);
                    
                    // 更新连线
                    links.attr('d', d3.linkHorizontal()
                        .x(d => d.y)
                        .y(d => d.x));
                })
                .on('end', function(event, d) {
                    if (d === app.mindmap.selectedNode) {
                        d3.select(this).select('rect').style('stroke', '#d68910');
                    } else {
                        d3.select(this).select('rect').style('stroke', null);
                    }
                });
            
            nodes.call(dragHandler);
            
            // 添加双击编辑功能
            nodes.on('dblclick', function(event, d) {
                event.stopPropagation();
                const newName = prompt('编辑节点内容:', d.data.name);
                if (newName && newName.trim()) {
                    d.data.name = newName.trim();
                    d3.select(this).select('text').text(d.data.name);
                }
            });
            
            // 单击选中
            nodes.on('click', function(event, d) {
                event.stopPropagation();
                app.mindmap.selectedNode = d;
                nodes.select('rect').style('fill', node => {
                    if (node === d) return '#f39c12';
                    return node.depth === 0 ? '#e74c3c' : node.depth === 1 ? '#3498db' : '#2ecc71';
                }).style('stroke', node => node === d ? '#d68910' : null);
            });
            
            app.mindmapSvg = svg;
        },

        addNode() {
            if (!app.mindmap.selectedNode) {
                alert('请先选择一个父节点（点击节点选中）');
                return;
            }
            
            const nodeName = prompt('输入新节点名称:', '新节点');
            if (nodeName && nodeName.trim()) {
                if (!app.mindmap.selectedNode.data.children) {
                    app.mindmap.selectedNode.data.children = [];
                }
                app.mindmap.selectedNode.data.children.push({ name: nodeName.trim() });
                app.mindmap.render();
            }
        },

        deleteNode() {
            if (!app.mindmap.selectedNode) {
                alert('请先选择要删除的节点（点击节点选中）');
                return;
            }
            
            if (app.mindmap.selectedNode.depth === 0) {
                alert('不能删除根节点');
                return;
            }
            
            if (confirm('确定删除此节点及其所有子节点？')) {
                const parent = app.mindmap.selectedNode.parent;
                if (parent && parent.data.children) {
                    const index = parent.data.children.indexOf(app.mindmap.selectedNode.data);
                    if (index > -1) {
                        parent.data.children.splice(index, 1);
                    }
                }
                app.mindmap.selectedNode = null;
                app.mindmap.render();
            }
        },

        resetView() {
            app.mindmap.selectedNode = null;
            app.mindmap.render();
        }
    },

    // Diagram 图表编辑器
    initDiagram() {
        const container = document.getElementById('diagram-container');
        
        try {
            if (typeof mxGraph !== 'undefined') {
                // 创建 mxGraph 实例
                const graph = new mxGraph(container);
                graph.setConnectable(true);
                graph.setMultigraph(false);
                
                // 启用橡皮筋选择
                if (typeof mxRubberband !== 'undefined') {
                    new mxRubberband(graph);
                }
                
                this.mxgraphEditor = graph;
                
                // 获取默认父节点
                const parent = graph.getDefaultParent();
                
                graph.getModel().beginUpdate();
                try {
                    // 添加一个示例矩形
                    const v1 = graph.insertVertex(parent, null, '开始', 100, 100, 120, 60);
                } finally {
                    graph.getModel().endUpdate();
                }
            } else {
                // 使用简单的Canvas绘图作为替代
                this.initSimpleDiagram(container);
            }
        } catch (err) {
            console.error('初始化图表编辑器失败:', err);
            this.initSimpleDiagram(container);
        }
    },

    // 简单图表编辑器（Canvas实现）
    initSimpleDiagram(container) {
        const existingCanvas = document.getElementById('diagram-canvas');
        if (!existingCanvas) {
            const canvas = document.createElement('canvas');
            canvas.id = 'diagram-canvas';
            canvas.style.cssText = 'width: 100%; height: 100%; background: white;';
            container.appendChild(canvas);
        }
        
        const canvas = document.getElementById('diagram-canvas');
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        
        const ctx = canvas.getContext('2d');
        
        this.mxgraphEditor = { canvas, ctx };
        this.diagram.shapes = [];
        this.diagram.history = [];
        
        // 绘制示例图形
        this.diagram.shapes.push({
            type: 'rectangle',
            x: 100,
            y: 100,
            width: 120,
            height: 60,
            color: '#3498db'
        });
        this.diagram.history.push(JSON.parse(JSON.stringify(app.diagram.shapes)));
        this.diagram.redraw();
        
        // 添加鼠标事件监听
        this.diagram.setupCanvasEvents();
    },

    diagram: {
        shapes: [],
        history: [],
        selectedShape: null,
        isDragging: false,
        dragOffset: { x: 0, y: 0 },

        insertShape(shapeType) {
            if (!app.mxgraphEditor) return;
            
            // 检查是否是mxGraph实例
            if (app.mxgraphEditor.getModel) {
                const graph = app.mxgraphEditor;
                const parent = graph.getDefaultParent();
                
                graph.getModel().beginUpdate();
                try {
                    let style = '';
                    const x = 200 + Math.random() * 100;
                    const y = 200 + Math.random() * 100;
                    const width = 120;
                    const height = 80;
                    
                    switch(shapeType) {
                        case 'rectangle':
                            style = 'rounded=0';
                            break;
                        case 'ellipse':
                            style = 'ellipse';
                            break;
                        case 'rhombus':
                            style = 'rhombus';
                            break;
                        case 'triangle':
                            style = 'triangle';
                            break;
                        case 'arrow':
                            style = 'shape=arrow';
                            break;
                    }
                    
                    graph.insertVertex(parent, null, shapeType, x, y, width, height, style);
                } finally {
                    graph.getModel().endUpdate();
                }
            } else if (app.mxgraphEditor.canvas) {
                // 使用Canvas实现
                const shape = {
                    type: shapeType,
                    x: 100 + Math.random() * 400,
                    y: 100 + Math.random() * 300,
                    width: 120,
                    height: 80,
                    color: '#3498db'
                };
                
                app.diagram.shapes.push(shape);
                app.diagram.history.push(JSON.parse(JSON.stringify(app.diagram.shapes)));
                app.diagram.redraw();
            }
        },

        redraw() {
            if (!app.mxgraphEditor.canvas) return;
            
            const ctx = app.mxgraphEditor.ctx;
            const canvas = app.mxgraphEditor.canvas;
            
            // 清空画布
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // 绘制所有形状
            app.diagram.shapes.forEach(shape => {
                const isSelected = shape === app.diagram.selectedShape;
                ctx.fillStyle = shape.color;
                ctx.strokeStyle = isSelected ? '#f39c12' : '#2980b9';
                ctx.lineWidth = isSelected ? 3 : 2;
                
                const { x, y, width, height, type } = shape;
                
                switch(type) {
                    case 'rectangle':
                        ctx.fillRect(x, y, width, height);
                        ctx.strokeRect(x, y, width, height);
                        break;
                    case 'ellipse':
                        ctx.beginPath();
                        ctx.ellipse(x + width/2, y + height/2, width/2, height/2, 0, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.stroke();
                        break;
                    case 'rhombus':
                        ctx.beginPath();
                        ctx.moveTo(x + width/2, y);
                        ctx.lineTo(x + width, y + height/2);
                        ctx.lineTo(x + width/2, y + height);
                        ctx.lineTo(x, y + height/2);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                        break;
                    case 'triangle':
                        ctx.beginPath();
                        ctx.moveTo(x + width/2, y);
                        ctx.lineTo(x + width, y + height);
                        ctx.lineTo(x, y + height);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                        break;
                    case 'arrow':
                        const arrowWidth = width * 0.3;
                        ctx.beginPath();
                        ctx.moveTo(x, y + height/3);
                        ctx.lineTo(x + width - arrowWidth, y + height/3);
                        ctx.lineTo(x + width - arrowWidth, y);
                        ctx.lineTo(x + width, y + height/2);
                        ctx.lineTo(x + width - arrowWidth, y + height);
                        ctx.lineTo(x + width - arrowWidth, y + height*2/3);
                        ctx.lineTo(x, y + height*2/3);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                        break;
                }
                
                // 绘制文字
                ctx.fillStyle = 'white';
                ctx.font = '14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(type, x + width/2, y + height/2);
                
                // 如果选中，显示选择框
                if (shape === app.diagram.selectedShape) {
                    ctx.strokeStyle = '#f39c12';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    ctx.strokeRect(x - 5, y - 5, width + 10, height + 10);
                    ctx.setLineDash([]);
                }
            });
        },

        clearCanvas() {
            if (confirm('确定清空所有图形？')) {
                app.diagram.shapes = [];
                app.diagram.history = [];
                app.diagram.selectedShape = null;
                app.diagram.redraw();
            }
        },

        undo() {
            if (app.diagram.history.length > 1) {
                app.diagram.history.pop();
                app.diagram.shapes = JSON.parse(JSON.stringify(app.diagram.history[app.diagram.history.length - 1]));
                app.diagram.selectedShape = null;
                app.diagram.redraw();
            } else {
                alert('没有可撤销的操作');
            }
        },

        // 检查点是否在形状内
        isPointInShape(x, y, shape) {
            switch(shape.type) {
                case 'rectangle':
                    return x >= shape.x && x <= shape.x + shape.width &&
                           y >= shape.y && y <= shape.y + shape.height;
                
                case 'ellipse':
                    const cx = shape.x + shape.width / 2;
                    const cy = shape.y + shape.height / 2;
                    const rx = shape.width / 2;
                    const ry = shape.height / 2;
                    return Math.pow((x - cx) / rx, 2) + Math.pow((y - cy) / ry, 2) <= 1;
                
                case 'rhombus':
                case 'triangle':
                case 'arrow':
                    // 简化：使用矩形边界检测
                    return x >= shape.x && x <= shape.x + shape.width &&
                           y >= shape.y && y <= shape.y + shape.height;
                
                default:
                    return false;
            }
        },

        // 设置Canvas事件监听
        setupCanvasEvents() {
            if (!app.mxgraphEditor.canvas) return;
            
            const canvas = app.mxgraphEditor.canvas;
            
            canvas.style.cursor = 'default';
            
            // 鼠标按下
            canvas.onmousedown = (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                // 从后往前查找（后添加的在上层）
                for (let i = app.diagram.shapes.length - 1; i >= 0; i--) {
                    const shape = app.diagram.shapes[i];
                    if (app.diagram.isPointInShape(x, y, shape)) {
                        app.diagram.selectedShape = shape;
                        app.diagram.isDragging = true;
                        app.diagram.dragOffset.x = x - shape.x;
                        app.diagram.dragOffset.y = y - shape.y;
                        
                        canvas.style.cursor = 'move';
                        app.diagram.redraw();
                        break;
                    }
                }
                
                // 如果没有点击任何形状，取消选中
                if (!app.diagram.isDragging) {
                    app.diagram.selectedShape = null;
                    app.diagram.redraw();
                }
            };
            
            // 鼠标移动
            canvas.onmousemove = (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                if (app.diagram.isDragging && app.diagram.selectedShape) {
                    // 更新形状位置
                    app.diagram.selectedShape.x = x - app.diagram.dragOffset.x;
                    app.diagram.selectedShape.y = y - app.diagram.dragOffset.y;
                    app.diagram.redraw();
                } else {
                    // 检查鼠标是否在形状上，改变光标
                    let onShape = false;
                    for (let i = app.diagram.shapes.length - 1; i >= 0; i--) {
                        if (app.diagram.isPointInShape(x, y, app.diagram.shapes[i])) {
                            onShape = true;
                            break;
                        }
                    }
                    canvas.style.cursor = onShape ? 'move' : 'default';
                }
            };
            
            // 鼠标抬起
            canvas.onmouseup = () => {
                if (app.diagram.isDragging) {
                    app.diagram.isDragging = false;
                    // 保存到历史记录
                    app.diagram.history.push(JSON.parse(JSON.stringify(app.diagram.shapes)));
                }
            };
            
            // 鼠标离开画布
            canvas.onmouseleave = () => {
                app.diagram.isDragging = false;
                canvas.style.cursor = 'default';
            };
            
            // 双击删除
            canvas.ondblclick = (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                for (let i = app.diagram.shapes.length - 1; i >= 0; i--) {
                    if (app.diagram.isPointInShape(x, y, app.diagram.shapes[i])) {
                        if (confirm('删除此图形？')) {
                            app.diagram.shapes.splice(i, 1);
                            app.diagram.selectedShape = null;
                            app.diagram.history.push(JSON.parse(JSON.stringify(app.diagram.shapes)));
                            app.diagram.redraw();
                        }
                        break;
                    }
                }
            };
        }
    },

    // 打开文件
    openFile(type) {
        const fileInput = document.getElementById('file-input');
        
        let accept = '*/*';
        if (type === 'excel') {
            accept = '.xlsx,.xls,.csv';
        } else if (type === 'word') {
            accept = '.docx,.doc';
        } else if (type === 'ppt') {
            accept = '.pptx,.ppt';
        } else if (type === 'mindmap') {
            accept = '.xmind,.km';
        } else if (type === 'diagram') {
            accept = '.vsdx,.xml';
        }
        
        fileInput.accept = accept;
        fileInput.click();
    },

    // 加载文件
    async loadFile(file) {
        this.currentFilename = file.name;
        document.getElementById('filename').textContent = this.currentFilename;
        
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (['xlsx', 'xls', 'csv'].includes(ext)) {
            await this.loadExcelFile(file);
        } else if (['docx', 'doc'].includes(ext)) {
            await this.loadWordFile(file);
        } else if (['pptx', 'ppt'].includes(ext)) {
            await this.loadPPTFile(file);
        } else if (['json', 'xmind', 'km'].includes(ext)) {
            await this.loadMindMapFile(file);
        } else if (['xml', 'vsdx'].includes(ext)) {
            await this.loadDiagramFile(file);
        } else {
            alert('不支持的文件格式: ' + ext);
        }
    },

    // 加载思维导图文件
    async loadMindMapFile(file) {
        this.switchEditor('mindmap');
        
        if (typeof d3 === 'undefined') {
            alert('D3.js 库未加载，无法加载思维导图');
            return;
        }
        
        const text = await file.text();
        try {
            const data = JSON.parse(text);
            this.mindmapData = data;
            this.mindmap.selectedNode = null;
            this.mindmap.render();
        } catch (err) {
            console.error('加载思维导图失败:', err);
            alert('加载思维导图失败: ' + err.message);
        }
    },

    // 加载图表文件
    async loadDiagramFile(file) {
        this.switchEditor('diagram');
        alert('图表文件加载功能开发中');
    },

    // 加载 Excel 文件
    async loadExcelFile(file) {
        this.switchEditor('excel');
        
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        
        // 转换为 x-spreadsheet 格式
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        const rows = {};
        jsonData.forEach((row, rowIndex) => {
            rows[rowIndex] = { cells: {} };
            row.forEach((cell, colIndex) => {
                rows[rowIndex].cells[colIndex] = { text: cell };
            });
        });
        
        if (this.spreadsheet) {
            this.spreadsheet.loadData([{ rows }]);
        }
    },

    // 加载 Word 文件
    async loadWordFile(file) {
        this.switchEditor('word');
        
        const arrayBuffer = await file.arrayBuffer();
        
        mammoth.convertToHtml({ arrayBuffer: arrayBuffer })
            .then((result) => {
                if (this.quill) {
                    const delta = this.quill.clipboard.convert(result.value);
                    this.quill.setContents(delta);
                }
            })
            .catch((err) => {
                console.error('加载Word文件失败:', err);
                alert('加载Word文件失败');
            });
    },

    // 加载 PPT 文件
    async loadPPTFile(file) {
        this.switchEditor('ppt');
        alert('PPT文件加载功能开发中');
    },

    // 保存文件
    saveFile() {
        if (!this.currentEditor) {
            alert('请先打开或创建一个文档');
            return;
        }
        
        if (this.currentEditor === 'excel' || this.currentEditor === 'excel-lucky') {
            this.saveExcelFile();
        } else if (this.currentEditor === 'word') {
            this.saveWordFile();
        } else if (this.currentEditor === 'ppt') {
            this.savePPTFile();
        } else if (this.currentEditor === 'mindmap') {
            this.saveMindMapFile();
        } else if (this.currentEditor === 'diagram') {
            this.saveDiagramFile();
        }
    },

    // 保存 Excel 文件
    saveExcelFile() {
        if (this.currentEditor === 'excel-lucky' && this.luckysheet) {
            // Luckysheet 导出
            if (typeof luckysheet !== 'undefined' && luckysheet.exportExcel) {
                luckysheet.exportExcel({
                    type: 'xlsx',
                    filename: this.currentFilename
                });
            } else {
                alert('Luckysheet 导出功能需要额外配置');
            }
            return;
        }
        
        if (!this.spreadsheet) return;
        
        const data = this.spreadsheet.getData();
        const worksheet = XLSX.utils.aoa_to_sheet(this.convertXSpreadsheetToArray(data[0]));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        
        XLSX.writeFile(workbook, this.currentFilename);
    },

    convertXSpreadsheetToArray(sheetData) {
        const rows = sheetData.rows || {};
        const maxRow = Math.max(...Object.keys(rows).map(Number), 0);
        const result = [];
        
        for (let i = 0; i <= maxRow; i++) {
            const row = rows[i] || { cells: {} };
            const cells = row.cells || {};
            const maxCol = Math.max(...Object.keys(cells).map(Number), 0);
            const rowData = [];
            
            for (let j = 0; j <= maxCol; j++) {
                const cell = cells[j] || {};
                rowData.push(cell.text || '');
            }
            
            result.push(rowData);
        }
        
        return result;
    },

    // 保存 Word 文件
    async saveWordFile() {
        if (!this.quill) return;
        
        const content = this.quill.root.innerHTML;
        
        // 使用 docx 库创建文档
        try {
            const blob = new Blob([content], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = this.currentFilename.replace('.docx', '.html');
            a.click();
            URL.revokeObjectURL(url);
            
            alert('已导出为HTML格式。完整的DOCX导出需要服务器支持。');
        } catch (err) {
            console.error('保存Word文件失败:', err);
            alert('保存失败');
        }
    },

    // 保存 PPT 文件
    savePPTFile() {
        if (!this.pptPresentation) return;
        
        this.pptPresentation.writeFile({ fileName: this.currentFilename });
    },

    // 保存思维导图
    saveMindMapFile() {
        if (!this.mindmapData) return;
        
        const json = JSON.stringify(this.mindmapData, null, 2);
        
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.currentFilename;
        a.click();
        URL.revokeObjectURL(url);
    },

    // 保存图表
    saveDiagramFile() {
        if (!this.mxgraphEditor) return;
        
        try {
            if (this.mxgraphEditor.getModel && typeof mxCodec !== 'undefined') {
                const encoder = new mxCodec();
                const node = encoder.encode(this.mxgraphEditor.getModel());
                const xml = mxUtils.getXml(node);
                
                const blob = new Blob([xml], { type: 'text/xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = this.currentFilename.replace('.vsdx', '.xml');
                a.click();
                URL.revokeObjectURL(url);
            } else if (this.mxgraphEditor.canvas) {
                // 保存Canvas为图片
                this.mxgraphEditor.canvas.toBlob((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = this.currentFilename.replace('.vsdx', '.png');
                    a.click();
                    URL.revokeObjectURL(url);
                });
            }
        } catch (err) {
            console.error('保存图表失败:', err);
            alert('保存图表失败: ' + err.message);
        }
    },

    // 导出文件
    exportFile() {
        this.saveFile();
    }
};

// 返回主页
function goBack() {
    window.location.href = '../../index.html';
}

// 初始化应用
window.addEventListener('DOMContentLoaded', () => {
    app.init();
});
