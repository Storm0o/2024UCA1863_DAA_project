document.addEventListener('DOMContentLoaded', () => {

    // === DOM Elements ===
    const svgEl = d3.select("#vis-svg");
    const visContainer = document.getElementById('vis-container');
    const speedSlider = document.getElementById('speed-slider');
    const startBtn = document.getElementById('start-btn');
    const resetBtn = document.getElementById('reset-btn');
    const createGraphBtn = document.getElementById('create-graph-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const editGraphBtn = document.getElementById('edit-graph-btn');
    const prevBtn = document.getElementById('prev-graph');
    const nextBtn = document.getElementById('next-graph');
    const stepsLog = document.getElementById('steps-log');
    const graphTitle = document.getElementById('graph-title');
    const addGraphBtn = document.getElementById('add-graph-btn');
    const resetIconRefresh = document.getElementById('reset-icon-refresh');
    const resetIconCancel = document.getElementById('reset-icon-cancel');

    // === Graph Definitions ===
    const graphs = [
        { // Graph 1: 5-node cycle (Has cycle)
            nodes: [
                { id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }
            ],
            links: [
                { source: 0, target: 1 },
                { source: 1, target: 2 },
                { source: 2, target: 3 },
                { source: 3, target: 4 },
                { source: 4, target: 0 }
            ],
            name: "Graph 1: Simple 5-Cycle"
        },
        { // Graph 2: Complete graph K4 (Has cycle)
            nodes: [
                { id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }
            ],
            links: [
                { source: 0, target: 1 }, { source: 0, target: 2 }, { source: 0, target: 3 },
                { source: 1, target: 2 }, { source: 1, target: 3 },
                { source: 2, target: 3 }
            ],
            name: "Graph 2: Complete K4"
        },
        { // Graph 3: Bipartite K2,3 (No cycle)
            nodes: [
                { id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }
            ],
            links: [
                { source: 0, target: 2 }, { source: 0, target: 3 }, { source: 0, target: 4 },
                { source: 1, target: 2 }, { source: 1, target: 3 }, { source: 1, target: 4 }
            ],
            name: "Graph 3: No HC (K2,3)"
        }
    ];

    // === State Variables ===
    let currentGraphIndex = 0;
    let currentGraph;
    let simulation;
    let link, node;
    let adjMatrix = [];
    let numVertices = 0;
    let path = [];
    let visited = [];
    let isVisualizing = false;
    let stopVisualization = false;
    let isPaused = false;
    let stepForward = false;

    // Graph Editor State
    let isEditMode = false;
    let isDeleteMode = false;
    let editorNodes = [];
    let editorLinks = [];
    let editorNodeCounter = 0;
    let selectedNodeForConnection = null;
    let selectedNodeId = null;
    let editingGraphIndex = null;
    let editorSimulation;

    // === Helper Functions ===

    const _sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function pausableSleep() {
        return new Promise(async (resolve, reject) => {
            if (stepForward) {
                isPaused = true;
                stepForward = false;
            }

            let waitStart = Date.now();
            let duration = 1500 - parseInt(speedSlider.value, 10);

            while (true) {
                if (stopVisualization) return reject('stopped');

                if (isPaused) {
                    await _sleep(100); 
                    waitStart = Date.now(); 
                    duration = 1500 - parseInt(speedSlider.value, 10); 
                } else {
                    duration = 1500 - parseInt(speedSlider.value, 10);
                    if (Date.now() - waitStart >= duration) {
                        return resolve(); 
                    }
                    await _sleep(50); 
                }
            }
        });
    }

    function logStep(message, type = 'info') {
        if (stopVisualization && type !== 'backtrack') return; 
        const li = document.createElement('li');
        if (type === 'info') li.className = 'text-gray-700 text-sm';
        if (type === 'explore') li.className = 'text-blue-600 text-sm';
        if (type === 'backtrack') li.className = 'text-red-600 text-sm';
        if (type === 'success') li.className = 'text-green-600 font-bold';
        li.innerHTML = message;
        stepsLog.appendChild(li);
        stepsLog.parentElement.scrollTop = stepsLog.parentElement.scrollHeight;
    }

    function clearLogs() {
        stepsLog.innerHTML = '<li class="text-gray-500 italic">Logs cleared. Ready to start.</li>';
    }

    function setUIState(visualizing) {
        isVisualizing = visualizing;
        startBtn.disabled = visualizing;
        prevBtn.disabled = visualizing;
        nextBtn.disabled = visualizing;
        createGraphBtn.disabled = visualizing;
        editGraphBtn.disabled = visualizing;
        addGraphBtn.disabled = visualizing; 

        if (visualizing) {
            resetBtn.classList.remove('bg-gray-500', 'hover:bg-gray-600');
            resetBtn.classList.add('bg-red-500', 'hover:bg-red-600');
            resetIconRefresh.classList.add('hidden');
            resetIconCancel.classList.remove('hidden');
        } else {
            resetBtn.classList.remove('bg-red-500', 'hover:bg-red-600');
            resetBtn.classList.add('bg-gray-500', 'hover:bg-gray-600');
            resetIconRefresh.classList.remove('hidden');
            resetIconCancel.classList.add('hidden');
        }
    }
    
    // Build Adjacency Matrix
    function buildAdjMatrix(graph) {
        numVertices = graph.nodes.length;
        adjMatrix = Array(numVertices).fill(0).map(() => Array(numVertices).fill(0));
        
        const idToIndex = new Map(graph.nodes.map((n, i) => [n.id, i]));
        
        for (const link of graph.links) {
            const srcId = (typeof link.source === 'object') ? link.source.id : link.source;
            const tgtId = (typeof link.target === 'object') ? link.target.id : link.target;
            
            const srcIdx = idToIndex.get(srcId);
            const tgtIdx = idToIndex.get(tgtId);
            
            if (srcIdx !== undefined && tgtIdx !== undefined) {
                adjMatrix[srcIdx][tgtIdx] = 1;
                adjMatrix[tgtIdx][srcIdx] = 1;
            }
        }
    }
    
    // === D3 Drawing ===
    function drawGraph(graph) {
        svgEl.selectAll("*").remove(); 
        
        const width = visContainer.clientWidth;
        const height = visContainer.clientHeight;
        svgEl.attr("viewBox", [0, 0, width, height]);

        currentGraph = graph;
        
        const nodes = graph.nodes.map(d => ({...d}));
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        
        const links = graph.links.map(d => ({
            source: nodeMap.get(typeof d.source === 'object' ? d.source.id : d.source),
            target: nodeMap.get(typeof d.target === 'object' ? d.target.id : d.target)
        })).filter(l => l.source && l.target); 

        buildAdjMatrix({ nodes, links });


        simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(links).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-400))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .on("tick", ticked);

        link = svgEl.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(links)
            .enter().append("line")
            .attr("class", "link")
            .attr("id", d => `link-${d.source.id}-${d.target.id}`);

        node = svgEl.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(nodes)
            .enter().append("g")
            .attr("class", "node")
            .attr("id", d => `node-${d.id}`);
            
        // --- MODIFICATION HERE ---
        node.append("circle")
            .attr("r", 18); // Set radius as attribute
        // --- END MODIFICATION ---
        
        node.append("text")
            .text(d => d.id);
        
        node.call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

        function ticked() {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            node
                .attr("transform", d => `translate(${d.x},${d.y})`);
        }

        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }
        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }
        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }
        
        graphTitle.textContent = graph.name;
        if (!isEditMode) {
            editGraphBtn.classList.remove('hidden');
        }
        
        clearLogs();
        resetAlgorithmState();
    }

    // === Visualization & Highlighting ===
    function highlightNode(id, className = 'visited') {
        d3.select(`#node-${id}`).classed(className, true);
    }
    
    function unhighlightNode(id, className = 'visited') {
        d3.select(`#node-${id}`).classed(className, false);
    }
    
    function highlightEdge(u, v, className = 'active') {
        d3.select(`#link-${u}-${v}`).classed(className, true);
        d3.select(`#link-${v}-${u}`).classed(className, true);
    }

    function unhighlightEdge(u, v, className = 'active') {
        d3.select(`#link-${u}-${v}`).classed(className, false);
        d3.select(`#link-${v}-${u}`).classed(className, false);
    }
    
    function showFinalPath() {
        const idToIndex = new Map(currentGraph.nodes.map((n, i) => [n.id, i]));
        const pathIndices = path.map(id => idToIndex.get(id));

        for (let i = 0; i < pathIndices.length - 1; i++) {
            const u = path[i];
            const v = path[i+1];
            highlightEdge(u, v, 'path');
            highlightNode(u, 'path');
        }
        const lastNode = path[path.length - 1];
        const firstNode = path[0];
        highlightEdge(lastNode, firstNode, 'path');
        highlightNode(lastNode, 'path');
    }
    
    function showFailureState() {
        if (node) {
            node.classed('failed', true);
        }
        if (link) {
            link.classed('failed', true);
        }
    }

    // === Algorithm Logic ===
    function resetAlgorithmState() {
        stopVisualization = true; 
        isPaused = false;
        stepForward = false;
        path = [];
        
        if (node) node.classed('visited', false).classed('current', false).classed('path', false).classed('failed', false);
        if (link) link.classed('active', false).classed('path', false).classed('failed', false);
        
        setUIState(false);
    }

    async function startVisualization() {
        if (numVertices === 0) {
            logStep("Graph is empty. Add nodes and links.", "backtrack");
            return;
        }

        stopVisualization = false;
        isPaused = false;
        stepForward = false;
        setUIState(true);
        clearLogs();

        if (node) node.classed('visited', false).classed('current', false).classed('path', false).classed('failed', false);
        if (link) link.classed('active', false).classed('path', false).classed('failed', false);
        
        const nodes = currentGraph.nodes;
        const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
        const indexToId = new Map(nodes.map((n, i) => [i, n.id]));
        
        path = [];
        visited = Array(numVertices).fill(false);
        
        const startNodeId = indexToId.get(0);
        path.push(startNodeId);
        visited[0] = true;
        
        logStep(`Starting from node ${startNodeId}`, "info");
        
        try {
            highlightNode(startNodeId, 'visited');
            await pausableSleep(); 

            const foundCycle = await findHamiltonianCycleUtil(0, idToIndex, indexToId);

            if (stopVisualization) {
                // handled by 'stopped' error
            } else if (foundCycle) {
                logStep("Hamiltonian Cycle Found!", "success");
                showFinalPath();
            } else {
                logStep("No Hamiltonian Cycle found.", "backtrack");
                showFailureState(); 
            }
            
            setUIState(false); 

        } catch (err) {
            if (err === 'stopped') {
                logStep("Visualization stopped by user.", "backtrack");
                resetAlgorithmState(); 
            } else {
                console.error("Algorithm error:", err);
                logStep("An unexpected error occurred.", "backtrack");
                setUIState(false); 
            }
        }
    }

    async function findHamiltonianCycleUtil(u_idx, idToIndex, indexToId) {
        if (stopVisualization) throw 'stopped';
        
        const u_id = indexToId.get(u_idx);

        if (path.length === numVertices) {
            if (adjMatrix[u_idx][0] === 1) {
                const startNodeId = indexToId.get(0);
                logStep(`Found edge from last node ${u_id} to start node ${startNodeId}. Cycle!`, "success");
                highlightEdge(u_id, startNodeId, 'active');
                await pausableSleep(); 
                return true; 
            }
            return false;
        }

        for (let v_idx = 0; v_idx < numVertices; v_idx++) {
            if (adjMatrix[u_idx][v_idx] === 1 && !visited[v_idx]) {
                if (stopVisualization) throw 'stopped';

                const v_id = indexToId.get(v_idx);
                logStep(`Exploring edge ${u_id} -> ${v_id}`, "explore");
                highlightEdge(u_id, v_id, 'active');
                highlightNode(v_id, 'current');
                await pausableSleep(); 
                
                visited[v_idx] = true;
                path.push(v_id);
                highlightNode(v_id, 'visited');
                unhighlightNode(v_id, 'current');
                
                if (await findHamiltonianCycleUtil(v_idx, idToIndex, indexToId)) {
                    return true;
                }

                if (stopVisualization) throw 'stopped';
                logStep(`Backtracking from ${v_id}. Removing edge ${u_id} -> ${v_id}`, "backtrack");
                unhighlightEdge(u_id, v_id, 'active');
                unhighlightNode(v_id, 'visited');
                path.pop();
                visited[v_idx] = false;
                await pausableSleep(); 
            }
        }
        
        unhighlightNode(u_id, 'current');
        return false;
    }


    // === Graph Editor Functions ===
    function enterEditMode(existingGraph = null, graphIndex = null) {
        isEditMode = true;
        isDeleteMode = false;
        selectedNodeForConnection = null;
        selectedNodeId = null;
        editingGraphIndex = graphIndex;
        
        if (existingGraph) {
            editorNodes = existingGraph.nodes.map(n => ({...n}));
            const nodeMap = new Map(editorNodes.map(n => [n.id, n]));
            editorLinks = existingGraph.links.map(l => {
                const srcId = typeof l.source === 'object' ? l.source.id : l.source;
                const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
                return {
                    source: nodeMap.get(srcId),
                    target: nodeMap.get(tgtId)
                };
            }).filter(l => l.source && l.target);
        } else {
            editorNodes = [];
            editorLinks = [];
        }
        
        // Update UI
        createGraphBtn.classList.remove('hidden'); 
        addGraphBtn.classList.add('hidden'); 

        startBtn.disabled = true;
        resetBtn.disabled = true; 
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        editGraphBtn.classList.add('hidden');
        deleteBtn.classList.remove('hidden');
        deleteBtn.classList.remove('bg-red-600');
        deleteBtn.classList.add('bg-red-500');
        deleteBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Mode`;
        graphTitle.textContent = existingGraph ? `Editing: ${existingGraph.name}` : 'Graph Editor - Click to add nodes';
        
        svgEl.selectAll("*").remove();
        drawEditorGraph();
        
        svgEl.on('click', handleEditorClick);
    }
    
    function exitEditMode() {
        isEditMode = false;
        isDeleteMode = false;
        
        // Update UI
        createGraphBtn.classList.add('hidden'); 
        addGraphBtn.classList.remove('hidden'); 
        startBtn.disabled = false;
        resetBtn.disabled = false; 
        prevBtn.style.display = 'block';
        nextBtn.style.display = 'block';
        deleteBtn.classList.add('hidden');
        editGraphBtn.classList.remove('hidden');
        
        svgEl.on('click', null);
        
        const shouldSave = (editingGraphIndex !== null) || (editorNodes.length > 0);

        if (shouldSave) {
            const savedGraph = {
                nodes: editorNodes.map(n => ({ id: n.id })), 
                links: editorLinks.map(l => ({
                    source: typeof l.source === 'object' ? l.source.id : l.source,
                    target: typeof l.target === 'object' ? l.target.id : l.target
                })),
                name: editingGraphIndex !== null ? graphs[editingGraphIndex].name : `Custom Graph ${graphs.length + 1}`
            };
            
            if (editingGraphIndex !== null) {
                graphs[editingGraphIndex] = savedGraph;
                currentGraphIndex = editingGraphIndex;
            } else {
                graphs.push(savedGraph);
                currentGraphIndex = graphs.length - 1;
            }
            drawGraph(savedGraph);
        } else {
            if (graphs.length > 0) {
                 drawGraph(graphs[currentGraphIndex]);
            } else {
                svgEl.selectAll("*").remove();
                graphTitle.textContent = "No graphs available";
            }
        }

        editingGraphIndex = null;
    }
    
    function handleEditorClick(event) {
        if (isEditMode && !isDeleteMode && !event.defaultPrevented) {
            
            const [x, y] = d3.pointer(event, svgEl.node());
            
            const maxId = editorNodes.length > 0 
                ? Math.max(...editorNodes.map(n => n.id)) 
                : -1;
            const newId = maxId + 1;
            
            const newNode = {
                id: newId,
                x: x, y: y,
                fx: x, fy: y 
            };
            editorNodes.push(newNode);
            drawEditorGraph();
        }
    }
    
    function deleteNode(nodeId) {
        editorNodes = editorNodes.filter(n => n.id !== nodeId);
        
        editorLinks = editorLinks.filter(l => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return src !== nodeId && tgt !== nodeId;
        });
        
        if (selectedNodeForConnection && selectedNodeForConnection.id === nodeId) {
            selectedNodeForConnection = null;
            selectedNodeId = null;
        }
        
        if (editorNodes.length === 0 && editorLinks.length === 0 && isDeleteMode) {
            isDeleteMode = false;
            deleteBtn.classList.remove('bg-red-600');
            deleteBtn.classList.add('bg-red-500');
            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Mode`;
            graphTitle.textContent = 'Graph Editor - Click to add nodes';
        }
        drawEditorGraph(); 
    }

    function deleteLink(link) {
        editorLinks = editorLinks.filter(l => l !== link);
        drawEditorGraph();
    }

    function drawEditorGraph() {
        svgEl.selectAll("*").remove(); 
        
        const width = visContainer.clientWidth;
        const height = visContainer.clientHeight;
        svgEl.attr("viewBox", [0, 0, width, height]);

        if (editorSimulation) {
            editorSimulation.stop();
        }

        editorSimulation = d3.forceSimulation(editorNodes)
            .force("link", d3.forceLink(editorLinks).id(d => d.id).distance(100))
            .force("charge", d3.forceManyBody().strength(-400))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .on("tick", ticked);

        const editorLink = svgEl.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(editorLinks)
            .enter().append("line")
            .attr("class", "link")
            .classed('delete-hover', isDeleteMode)
            .on('click', handleEditorLinkClick);

        const editorNode = svgEl.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(editorNodes)
            .enter().append("g")
            .attr("class", "node")
            .attr("id", d => `node-${d.id}`)
            .classed('selected', d => d.id === selectedNodeId)
            .classed('delete-hover', isDeleteMode)
            .on('click', handleEditorNodeClick)
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));
        
        // --- MODIFICATION HERE ---
        editorNode.append("circle")
            .attr("r", 18); // Set radius as attribute
        // --- END MODIFICATION ---
        
        editorNode.append("text")
            .text(d => d.id);

        function ticked() {
            editorLink
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            
            editorNode
                .attr("transform", d => `translate(${d.x},${d.y})`);
        }

        function dragstarted(event, d) {
            if (!event.active) editorSimulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
        }
        function dragged(event, d) {
            d.fx = event.x; d.fy = event.y;
        }
        function dragended(event, d) {
            if (!event.active) editorSimulation.alphaTarget(0);
            d.fx = d.x; d.fy = d.y; 
        }
    }

    function handleEditorNodeClick(event, d) {
        event.stopPropagation(); 
        event.preventDefault();

        if (isDeleteMode) {
            deleteNode(d.id);
            return;
        }

        if (!selectedNodeForConnection) {
            selectedNodeForConnection = d;
            selectedNodeId = d.id;
            d3.select(event.currentTarget).classed('selected', true);
        } else {
            if (selectedNodeId === d.id) {
                selectedNodeForConnection = null;
                selectedNodeId = null;
                d3.select(event.currentTarget).classed('selected', false);
            } else {
                const sourceNode = selectedNodeForConnection;
                const targetNode = d;
                
                const linkExists = editorLinks.some(l => 
                    (l.source.id === sourceNode.id && l.target.id === targetNode.id) ||
                    (l.source.id === targetNode.id && l.target.id === sourceNode.id)
                );

                if (!linkExists) {
                    editorLinks.push({ source: sourceNode, target: targetNode });
                }

                selectedNodeId = null;
                selectedNodeForConnection = null;
                drawEditorGraph();
            }
        }
    }

    function handleEditorLinkClick(event, d) {
        event.stopPropagation();
        event.preventDefault();
        
        if (isDeleteMode) {
            deleteLink(d);
        }
    }

    // === Event Listeners ===
    startBtn.addEventListener('click', startVisualization);
    
    resetBtn.addEventListener('click', () => {
        if (isVisualizing) {
            stopVisualization = true; 
        } else {
            clearLogs();
            resetAlgorithmState(); 
        }
    });

    speedSlider.addEventListener('input', (e) => {
        // No-op, speed is read directly
    });

    prevBtn.addEventListener('click', () => {
        if (isVisualizing || isEditMode) return;
        currentGraphIndex = (currentGraphIndex - 1 + graphs.length) % graphs.length;
        drawGraph(graphs[currentGraphIndex]);
    });

    nextBtn.addEventListener('click', () => {
        if (isVisualizing || isEditMode) return;
        currentGraphIndex = (currentGraphIndex + 1) % graphs.length;
        drawGraph(graphs[currentGraphIndex]);
    });
    
    createGraphBtn.addEventListener('click', () => {
        if (isEditMode) {
            exitEditMode(); // Save graph
        }
    });

    addGraphBtn.addEventListener('click', () => {
        if (!isEditMode && !isVisualizing) {
            resetAlgorithmState(); 
            enterEditMode(null, null); // Create new graph
        }
    });
    
    editGraphBtn.addEventListener('click', () => {
        if (!isEditMode && !isVisualizing) {
            resetAlgorithmState(); 
            enterEditMode(graphs[currentGraphIndex], currentGraphIndex);
        }
    });

    deleteBtn.addEventListener('click', () => {
        if (!isEditMode) return;
        isDeleteMode = !isDeleteMode; 
        if (isDeleteMode) {
            deleteBtn.classList.remove('bg-red-500');
            deleteBtn.classList.add('bg-red-600');
            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                Exit Delete`;
            graphTitle.textContent = 'DELETE MODE: Click node/link to delete';
            
            if (selectedNodeForConnection) {
                d3.select(`#node-${selectedNodeId}`).classed('selected', false);
                selectedNodeForConnection = null;
                selectedNodeId = null;
            }
            svgEl.selectAll('.node').classed('delete-hover', true);
            svgEl.selectAll('.link').classed('delete-hover', true);
        } else {
            deleteBtn.classList.remove('bg-red-600');
            deleteBtn.classList.add('bg-red-500');
            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete Mode`;
            graphTitle.textContent = 'Graph Editor - Click to add nodes...';
            svgEl.selectAll('.node').classed('delete-hover', false);
            svgEl.selectAll('.link').classed('delete-hover', false);
        }
    });

    // === Swipe Gestures (Hammer.js) ===
    const hammer = new Hammer(visContainer);
    hammer.on('swipeleft', () => nextBtn.click());
    hammer.on('swiperight', () => prevBtn.click());

    // === Responsive Resize ===
    const resizeObserver = new ResizeObserver(() => {
        if (isEditMode) {
            drawEditorGraph();
        } else if (!isVisualizing && graphs[currentGraphIndex]) {
            drawGraph(graphs[currentGraphIndex]);
        }
    });
    resizeObserver.observe(visContainer);

    visContainer.addEventListener('click', (e) => {
        const target = e.target;
        const isBackgroundClick = (target.id === 'vis-container' || target.id === 'vis-svg');

        if (!isEditMode && isBackgroundClick) {
            if (isVisualizing) {
                isPaused = !isPaused;
                if (isPaused) {
                    logStep("--- Visualization Paused ---", "info");
                } else {
                    logStep("--- Visualization Resumed ---", "info");
                }
            } else {
                if (!startBtn.disabled) {
                    logStep("--- Starting Visualization (Tapped) ---", "info");
                    startBtn.click(); 
                }
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (isVisualizing && isPaused) {
            if (e.key === 'ArrowRight') {
                logStep("Stepping forward...", "info");
                stepForward = true;
                isPaused = false; 
            } else if (e.key === 'ArrowLeft') {
                logStep("Step backward is not possible with this recursive algorithm.", "backtrack");
            }
        }
    });

    // === Initial Load ===
    if (graphs.length > 0) {
         drawGraph(graphs[currentGraphIndex]);
    } else {
         graphTitle.textContent = "No graphs loaded";
         editGraphBtn.classList.add('hidden');
    }

});
