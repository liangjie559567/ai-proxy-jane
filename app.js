const http = require('http')
const fs = require('fs')
const path = require('path')
const openaiProxy = require('./openai-proxy')
const claudeProxy = require('./claude-proxy')
const ProxyPool = require('./proxyPool')

const config = require('./config')
const RateLimiter = require('./rateLimit')
const ipManager = require('./ipManager')
const { sendResponse, logger } = require('./utils')

const PROXY_PORT = config.PROXY_PORT

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Anthropic-Version, Anthropic-Beta, Authorization, OpenAI-Beta',
	'Access-Control-Max-Age': '86400'
}

// 创建速率限制器
const rateLimiter = new RateLimiter(config.RATE_LIMIT_REQUESTS, config.RATE_LIMIT_INTERVAL)

// 创建代理池
const proxyPool = new ProxyPool(config)

// 初始化代理池
proxyPool.initialize()

// 每小时清理一次 IP 错误计数器
setInterval(() => ipManager.cleanupIPErrorCounter(), 60 * 60 * 1000)

// 读取用户信息
let users = JSON.parse(fs.readFileSync('users.json', 'utf8'))

const server = http.createServer((req, res) => {
	const sourceIP = req.socket.remoteAddress

	// 处理CORS预检请求
	if (req.method === 'OPTIONS') {
		res.writeHead(204, CORS_HEADERS)
		res.end()
		return
	}

	// 为所有响应添加CORS头
	Object.keys(CORS_HEADERS).forEach(header => {
		res.setHeader(header, CORS_HEADERS[header])
	})

	// 处理前端页面请求
	if (req.url === '/' || req.url === '/index.html') {
		fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, content) => {
			if (err) {
				res.writeHead(500)
				res.end('Error loading index.html')
			} else {
				res.writeHead(200, { 'Content-Type': 'text/html' })
				res.end(content)
			}
		})
		return
	}

	// 处理API请求
	if (req.url.startsWith('/api/')) {
		handleApiRequest(req, res)
		return
	}

	// 检查 IP 是否在黑名单中
	if (ipManager.isBlacklisted(sourceIP)) {
		sendResponse(res, 403, { error: 'IP 已被禁止访问' })
		return
	}

	// 检查速率限制
	if (rateLimiter.isRateLimited(sourceIP)) {
		sendResponse(res, 429, { error: '请求过于频繁，请稍后再试' })
		return
	}

	// 获取代理IP
	proxyPool.getNextProxy().then(proxyIP => {
		// 根据 host 选择适当的代理
		const hostname = req.headers.host
		if (hostname) {
			if (hostname.startsWith('claude.api.')) {
				claudeProxy.handleRequest(req, res, ipManager.recordIPError.bind(ipManager), proxyIP)
			} else if (hostname.startsWith('openai.api.')) {
				openaiProxy.handleRequest(req, res, ipManager.recordIPError.bind(ipManager), proxyIP)
			} else {
				sendResponse(res, 404, { error: '不支持的API' })
			}
		} else {
			sendResponse(res, 400, { error: '未识别的 hostname' })
		}
	}).catch(error => {
		logger.error('获取代理IP时发生错误:', error)
		sendResponse(res, 500, { error: '内部服务器错误' })
	})
})

function handleApiRequest(req, res) {
	if (req.url === '/api/login' && req.method === 'POST') {
		let body = ''
		req.on('data', chunk => {
			body += chunk.toString()
		})
		req.on('end', () => {
			const { username, password } = JSON.parse(body)
			if (users[username] === password) {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ success: true }))
			} else {
				res.writeHead(401, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }))
			}
		})
	} else if (req.url === '/api/update-user' && req.method === 'POST') {
		let body = ''
		req.on('data', chunk => {
			body += chunk.toString()
		})
		req.on('end', () => {
			const { newUsername, newPassword } = JSON.parse(body)
			users = { [newUsername]: newPassword }
			fs.writeFileSync('users.json', JSON.stringify(users, null, 2))
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ success: true }))
		})
	} else if (req.url === '/api/config' && req.method === 'GET') {
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({
			PROXY_PORT: config.PROXY_PORT,
			PROXY_LIST: config.PROXY_LIST,
			PROXY_SCRAPER_URLS: config.PROXY_SCRAPER_URLS,
			PROXY_CONCURRENCY_LIMIT: config.PROXY_CONCURRENCY_LIMIT
		}))
	} else if (req.url === '/api/config' && req.method === 'POST') {
		let body = ''
		req.on('data', chunk => {
			body += chunk.toString()
		})
		req.on('end', () => {
			const newConfig = JSON.parse(body)
			Object.assign(config, newConfig)
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ message: 'Configuration updated successfully' }))
		})
	} else if (req.url === '/api/proxy-status' && req.method === 'GET') {
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({
			totalProxies: proxyPool.getTotalProxies(),
			activeProxies: proxyPool.getActiveProxies(),
			currentConcurrency: proxyPool.getCurrentConcurrency(),
			openaiProxyAddress: `http://openai.api.your-domain.com:${config.PROXY_PORT}`,
			claudeProxyAddress: `http://claude.api.your-domain.com:${config.PROXY_PORT}`
		}))
	} else {
		res.writeHead(404, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Not Found' }))
	}
}

server.listen(PROXY_PORT, () => {
	logger.log(`API代理正在监听端口 ${PROXY_PORT}`)
	logger.log(`当前配置: ${JSON.stringify(config, undefined, '\t')}`)
})

// 错误处理
server.on('error', error => {
	logger.error('服务器错误:', error)
})

process.on('uncaughtException', error => {
	logger.error('未捕获的异常:', error)
})

process.on('unhandledRejection', (reason, promise) => {
	logger.error('未处理的拒绝:', reason)
})
