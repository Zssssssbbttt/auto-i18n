#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ====== 路径补全核心函数 ======
function tabCompletePath(input, baseDir) {
    // 处理 Windows 反斜杠
    const normalized = input.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    const dirPart = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
    const partial = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
    
    const resolvedDir = path.resolve(baseDir, dirPart || '.');
    
    // 目录不存在或无权限
    if (!fs.existsSync(resolvedDir)) {
        return { matches: [] };
    }
    
    try {
        const stat = fs.statSync(resolvedDir);
        if (!stat.isDirectory()) return { matches: [] };
    } catch {
        return { matches: [] };
    }
    
    let entries;
    try {
        entries = fs.readdirSync(resolvedDir);
    } catch {
        return { matches: [] };
    }
    
    // 匹配并排序（目录加 / 后缀）
    const matches = entries
        .filter(e => e.toLowerCase().startsWith(partial.toLowerCase()))
        .map(e => {
            try {
                return fs.statSync(path.join(resolvedDir, e)).isDirectory() 
                    ? e + '/' 
                    : e;
            } catch {
                return e;
            }
        })
        .sort();
    
    return { matches };
}

// ====== completer ======
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line) => {
        const result = tabCompletePath(line, process.cwd());
        if (result.matches.length === 0) {
            return [[], line];
        }
        return [result.matches, line];
    }
});

// ====== 启动 ======
console.log('\x1b[36m%s\x1b[0m', '🚀 路径补全演示 (按 Tab 补全，Ctrl+C 退出)');
console.log('\x1b[90m%s\x1b[0m', `📁 当前目录: ${process.cwd()}`);
console.log('\x1b[33m%s\x1b[0m', '└─ 输入路径并按 Tab 补全:');

rl.prompt();