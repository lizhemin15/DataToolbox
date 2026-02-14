// 象棋游戏完整实现
// 使用方法：在 script.js 中引入此文件

function startXiangqi(opponentId, isHost) {
    const peer = peers.get(opponentId);
    const peerName = peer ? peer.name : '对方';
    const mySide = isHost ? 'red' : 'black';
    const myTurn = isHost;
    
    const initBoard = () => {
        const b = Array(10).fill(null).map(() => Array(9).fill(null));
        b[0] = ['車','馬','相','仕','帥','仕','相','馬','車'];
        b[2][1] = '砲'; b[2][7] = '砲';
        b[3][0] = '卒'; b[3][2] = '卒'; b[3][4] = '卒'; b[3][6] = '卒'; b[3][8] = '卒';
        b[9] = ['车','马','象','士','将','士','象','马','车'];
        b[7][1] = '炮'; b[7][7] = '炮';
        b[6][0] = '兵'; b[6][2] = '兵'; b[6][4] = '兵'; b[6][6] = '兵'; b[6][8] = '兵';
        return b;
    };
    
    const board = initBoard();
    let currentTurn = myTurn;
    let selectedPiece = null;
    
    const game = document.createElement('div');
    game.className = 'xiangqi-game-modal';
    game.innerHTML = `
        <div class="xiangqi-game-content">
            <div class="xiangqi-game-header">
                <span>象棋 - 对战 ${peerName}</span>
                <button class="xiangqi-game-close">×</button>
            </div>
            <div class="xiangqi-game-body">
                <div class="xiangqi-info">
                    <div class="xiangqi-player">
                        <span class="xiangqi-dot" style="background: #000"></span>
                        <span>${isHost ? peerName : myName}</span>
                    </div>
                    <div class="xiangqi-status">${myTurn ? '你的回合' : '对方回合'}</div>
                    <div class="xiangqi-player">
                        <span class="xiangqi-dot" style="background: #dc143c"></span>
                        <span>${isHost ? myName : peerName}</span>
                    </div>
                </div>
                <canvas id="xiangqiCanvas" width="450" height="550"></canvas>
            </div>
        </div>
    `;
    
    document.body.appendChild(game);
    setTimeout(() => game.classList.add('show'), 10);
    
    const canvas = game.querySelector('#xiangqiCanvas');
    const ctx = canvas.getContext('2d');
    const cellSize = 45;
    const padding = 30;
    
    const getPieceColor = (p) => !p ? null : '车马象士将炮兵'.includes(p) ? 'red' : 'black';
    const isOwnPiece = (p) => getPieceColor(p) === mySide;
    
    const isValidMove = (fromR, fromC, toR, toC) => {
        const p = board[fromR][fromC];
        if (!p || toR < 0 || toR >= 10 || toC < 0 || toC >= 9) return false;
        if (isOwnPiece(board[toR][toC])) return false;
        
        const type = ['車','车'].includes(p) ? 'car' :
                     ['馬','马'].includes(p) ? 'horse' :
                     ['相','象'].includes(p) ? 'elephant' :
                     ['仕','士'].includes(p) ? 'guard' :
                     ['帥','将'].includes(p) ? 'king' :
                     ['砲','炮'].includes(p) ? 'cannon' : 'pawn';
        
        const dx = Math.abs(toC - fromC), dy = Math.abs(toR - fromR);
        
        switch (type) {
            case 'car':
                if (fromR !== toR && fromC !== toC) return false;
                const [minR, maxR] = [Math.min(fromR, toR), Math.max(fromR, toR)];
                const [minC, maxC] = [Math.min(fromC, toC), Math.max(fromC, toC)];
                if (fromR === toR) {
                    for (let c = minC + 1; c < maxC; c++) if (board[fromR][c]) return false;
                } else {
                    for (let r = minR + 1; r < maxR; r++) if (board[r][fromC]) return false;
                }
                return true;
                
            case 'horse':
                if (!((dx === 1 && dy === 2) || (dx === 2 && dy === 1))) return false;
                const legR = dx === 2 ? fromR : fromR + Math.sign(toR - fromR);
                const legC = dx === 2 ? fromC + Math.sign(toC - fromC) : fromC;
                return !board[legR][legC];
                
            case 'elephant':
                if (dx !== 2 || dy !== 2) return false;
                if (p === '象' && toR > 4) return false;
                if (p === '相' && toR < 5) return false;
                return !board[(fromR + toR) / 2][(fromC + toC) / 2];
                
            case 'guard':
                if (dx !== 1 || dy !== 1 || toC < 3 || toC > 5) return false;
                return p === '士' ? toR <= 2 : toR >= 7;
                
            case 'king':
                if (toC < 3 || toC > 5) return false;
                if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
                    return p === '将' ? toR <= 2 : toR >= 7;
                }
                if (fromC === toC && ['将','帥'].includes(board[toR][toC])) {
                    const [minR, maxR] = [Math.min(fromR, toR), Math.max(fromR, toR)];
                    for (let r = minR + 1; r < maxR; r++) if (board[r][toC]) return false;
                    return true;
                }
                return false;
                
            case 'cannon':
                if (fromR !== toR && fromC !== toC) return false;
                let cnt = 0;
                const [minR2, maxR2] = [Math.min(fromR, toR), Math.max(fromR, toR)];
                const [minC2, maxC2] = [Math.min(fromC, toC), Math.max(fromC, toC)];
                if (fromR === toR) {
                    for (let c = minC2 + 1; c < maxC2; c++) if (board[fromR][c]) cnt++;
                } else {
                    for (let r = minR2 + 1; r < maxR2; r++) if (board[r][fromC]) cnt++;
                }
                return board[toR][toC] ? cnt === 1 : cnt === 0;
                
            case 'pawn':
                const forward = p === '兵' ? -1 : 1;
                const crossRiver = p === '兵' ? fromR < 5 : fromR > 4;
                if (fromR + forward === toR && fromC === toC) return true;
                if (crossRiver && fromR === toR && dx === 1) return true;
                return false;
        }
        return false;
    };
    
    const drawBoard = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f4e4c1';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        
        for (let i = 0; i < 10; i++) {
            ctx.beginPath();
            ctx.moveTo(padding, padding + cellSize * i);
            ctx.lineTo(padding + cellSize * 8, padding + cellSize * i);
            ctx.stroke();
        }
        
        for (let i = 0; i < 9; i++) {
            [[0, 4], [5, 9]].forEach(([s, e]) => {
                ctx.beginPath();
                ctx.moveTo(padding + cellSize * i, padding + cellSize * s);
                ctx.lineTo(padding + cellSize * i, padding + cellSize * e);
                ctx.stroke();
            });
        }
        
        [[0, 2], [7, 9]].forEach(([r1, r2]) => {
            ctx.beginPath();
            ctx.moveTo(padding + cellSize * 3, padding + cellSize * r1);
            ctx.lineTo(padding + cellSize * 5, padding + cellSize * r2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(padding + cellSize * 5, padding + cellSize * r1);
            ctx.lineTo(padding + cellSize * 3, padding + cellSize * r2);
            ctx.stroke();
        });
        
        ctx.font = '20px SimSun';
        ctx.fillStyle = '#000';
        ctx.fillText('楚河', padding + cellSize * 0.5, padding + cellSize * 4.7);
        ctx.fillText('汉界', padding + cellSize * 6.5, padding + cellSize * 4.7);
        
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 9; col++) {
                if (!board[row][col]) continue;
                
                const x = padding + cellSize * col;
                const y = padding + cellSize * row;
                
                if (selectedPiece && selectedPiece.row === row && selectedPiece.col === col) {
                    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
                    ctx.beginPath();
                    ctx.arc(x, y, cellSize * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                }
                
                ctx.beginPath();
                ctx.arc(x, y, cellSize * 0.42, 0, Math.PI * 2);
                ctx.fillStyle = '#f4e4c1';
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                ctx.stroke();
                
                ctx.font = 'bold 24px SimSun';
                ctx.fillStyle = getPieceColor(board[row][col]) === 'red' ? '#dc143c' : '#000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(board[row][col], x, y);
            }
        }
        
        if (selectedPiece) {
            ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
            for (let row = 0; row < 10; row++) {
                for (let col = 0; col < 9; col++) {
                    if (isValidMove(selectedPiece.row, selectedPiece.col, row, col)) {
                        ctx.beginPath();
                        ctx.arc(padding + cellSize * col, padding + cellSize * row, 8, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }
    };
    
    canvas.addEventListener('click', (e) => {
        if (!currentTurn) {
            showToast('还没到你的回合', 'warning');
            return;
        }
        
        const rect = canvas.getBoundingClientRect();
        const col = Math.round((e.clientX - rect.left - padding) / cellSize);
        const row = Math.round((e.clientY - rect.top - padding) / cellSize);
        
        if (row < 0 || row >= 10 || col < 0 || col >= 9) return;
        
        if (selectedPiece) {
            if (isValidMove(selectedPiece.row, selectedPiece.col, row, col)) {
                const captured = board[row][col];
                board[row][col] = board[selectedPiece.row][selectedPiece.col];
                board[selectedPiece.row][selectedPiece.col] = null;
                
                if (['将','帥'].includes(captured)) {
                    showToast('你赢了！🎉', 'success');
                    game.querySelector('.xiangqi-status').textContent = '你赢了！';
                    currentTurn = false;
                    sendWsMessage({ type: 'game-over', to: opponentId, gameType: 'xiangqi', winner: myId, timestamp: Date.now() });
                } else {
                    currentTurn = false;
                    game.querySelector('.xiangqi-status').textContent = '对方回合';
                    sendWsMessage({ type: 'game-move', to: opponentId, gameType: 'xiangqi', move: { from: [selectedPiece.row, selectedPiece.col], to: [row, col] }, timestamp: Date.now() });
                }
                selectedPiece = null;
            } else {
                selectedPiece = isOwnPiece(board[row][col]) ? { row, col } : null;
            }
        } else {
            selectedPiece = isOwnPiece(board[row][col]) ? { row, col } : null;
        }
        drawBoard();
    });
    
    const originalHandler = window.handleBoardGameMove;
    window.handleBoardGameMove = function(data) {
        if (currentGame && currentGame.type === 'xiangqi' && data.move) {
            const [fR, fC] = data.move.from;
            const [tR, tC] = data.move.to;
            const captured = board[tR][tC];
            board[tR][tC] = board[fR][fC];
            board[fR][fC] = null;
            
            if (['将','帥'].includes(captured)) {
                showToast('对方赢了', 'info');
                game.querySelector('.xiangqi-status').textContent = '对方赢了';
                currentTurn = false;
            } else {
                currentTurn = true;
                game.querySelector('.xiangqi-status').textContent = '你的回合';
            }
            drawBoard();
        } else if (originalHandler) {
            originalHandler(data);
        }
    };
    
    game.querySelector('.xiangqi-game-close').addEventListener('click', () => {
        window.handleBoardGameMove = originalHandler;
        game.classList.remove('show');
        setTimeout(() => game.remove(), 300);
        currentGame = null;
    });
    
    drawBoard();
}
