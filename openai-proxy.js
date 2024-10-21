const fs = require('fs')
const https = require('https')
const url = require('url')
const WebSocket = require('ws')
const formidable = require('formidable')
const HttpsProxyAgent = require('https-proxy-agent')

const config = require('./config')
const { logger, sendResponse, writeLog, getRequestIp } = require('./utils')

const OPENAI_API_HOST = config.OPENAI_API_HOST
const ALLOWED_HEADERS = ['authorization', 'content-type', 'openai-beta']

function handleRequest(req, res, recordIPError, proxyIP) {
	const startTime = Date.now()
	const parsedUrl = url.parse(req.url || '')
	const sourceIP = getRequestIp(req)

	// 初始化日志对象
	const logData = {
		sourceIP,
		path: parsedUrl.path,
		params: {},
		totalTime: 0,
		inputTokens: null,
		outputTokens: null,
		proxyIP
	}

	// 验证authorization是否存在
	if (!req.headers['authorization']) {
		recordIPError(sourceIP, 'missing_authorization')
		sendResponse(res, 401, { error: '缺少authorization' })
		return
	}

	// 处理WebSocket连接
	if (req.headers['upgrade'] && req.headers['upgrade'].toLowerCase() === 'websocket') {
		handleWebSocket(req, res, logger, proxyIP)
		return
	}

	// 处理文件上传
	if (req.headers['content-type'] && req.headers['content-type'].startsWith('multipart/form-data')) {
		handleFileUpload(req, res, logger, writeLog, sendResponse, proxyIP)
		return
	}

	// 构建发送到OpenAI API的请求选项
	const options = {
		hostname: OPENAI_API_HOST,
		port: 443,
		path: parsedUrl.path,
		method: req.method,
		headers: {},
		agent: new HttpsProxyAgent(`http://${proxyIP}`)
	}

	// 仅保留允许的header
	ALLOWED_HEADERS.forEach(header => {
		if (req.headers[header]) {
			options.headers[header] = req.headers[header]
		}
	})

	options.headers['host'] = OPENAI_API_HOST

	let requestBody = ''
	req.on('data', chunk => {
		requestBody += chunk.toString()
	})

	req.on('end', () => {
		// 验证消息参数是否为JSON（仅对POST和PUT请求）
		if ((req.method === 'POST' || req.method === 'PUT') && req.headers['content-type'] === 'application/json') {
			try {
				const jsonBody = JSON.parse(requestBody)
				logData.params = jsonBody
			} catch (e) {
				sendResponse(res, 400, { error: '无效的JSON格式' })
				return
			}
		}

		const openaiReq = https.request(options, openaiRes => {
			// 处理文件下载
			if (openaiRes.headers['content-disposition']) {
				handleFileDownload(openaiRes, res)
				return
			}

			res.writeHead(openaiRes.statusCode || 500, openaiRes.headers)

			let responseBody = ''
			const isStreamResponse = openaiRes.headers['content-type']?.includes('text/event-stream')

			openaiRes.on('data', chunk => {
				responseBody += chunk

				try {
					res.write(chunk)
				} catch (error) {
					logger.error('写入响应时发生错误:', error)
					openaiReq.destroy()
				}

				if (isStreamResponse) {
					// 处理流式响应
					const lines = chunk.toString().split('\n')
					lines.forEach(line => {
						if (line.startsWith('data: ')) {
							try {
								const data = JSON.parse(line.slice(6))
								if (data.usage) {
									logData.inputTokens = data.usage.prompt_tokens
									logData.outputTokens = data.usage.completion_tokens
								}
							} catch {}
						}
					})
				}
			})

			openaiRes.on('end', () => {
				try {
					res.end()
				} catch (error) {
					logger.error('结束响应时发生错误:', error)
				}

				logData.totalTime = Date.now() - startTime

				if (!isStreamResponse) {
					try {
						const jsonResponse = JSON.parse(responseBody)
						if (jsonResponse.usage) {
							logData.inputTokens = jsonResponse.usage.prompt_tokens
							logData.outputTokens = jsonResponse.usage.completion_tokens
						}
					} catch {}
				}

				writeLog(JSON.stringify(logData))
			})
		})

		openaiReq.on('error', error => {
			logger.error('请求OpenAI API时发生错误:', error)
			sendResponse(res, 500, { error: '内部服务器错误' })

			// 在错误情况下也记录日志
			logData.totalTime = Date.now() - startTime
			logData.error = error.message
			writeLog(JSON.stringify(logData))
		})

		if (req.method !== 'GET' && req.method !== 'HEAD') {
			openaiReq.write(requestBody)
		}
		openaiReq.end()
	})
}

function handleWebSocket(req, socket, logger, proxyIP) {
	const wsClient = new WebSocket(`wss://${OPENAI_API_HOST}${req.url}`, {
		headers: {
			Authorization: req.headers['authorization'],
			'OpenAI-Beta': req.headers['openai-beta']
		},
		agent: new HttpsProxyAgent(`http://${proxyIP}`)
	})

	wsClient.on('open', () => {
		logger.log('WebSocket连接已打开')
		socket.write('HTTP/1.1 101 Switching Protocols\r\n' + 'Upgrade: websocket\r\n' + 'Connection: Upgrade\r\n' + '\r\n')
	})

	wsClient.on('message', data => {
		logger.log('收到WebSocket消息')
		try {
			socket.write(data)
		} catch (error) {
			logger.error('处理WebSocket消息时发生错误:', error)
			wsClient.close()
			socket.end()
		}
	})

	wsClient.on('close', (code, reason) => {
		logger.log(`WebSocket连接已关闭: 代码 ${code}, 原因: ${reason}`)
		socket.end()
	})

	wsClient.on('error', error => {
		logger.error('WebSocket错误:', error)
		socket.end()
	})

	socket.on('data', data => {
		logger.log('发送WebSocket消息')
		wsClient.send(data)
	})

	socket.on('end', () => {
		logger.log('客户端连接已关闭')
		wsClient.close()
	})

	socket.on('error', error => {
		logger.error('客户端socket错误:', error)
		wsClient.close()
	})
}

function handleFileUpload(req, res, logger, writeLog, sendResponse, proxyIP) {
	const form = new formidable.IncomingForm()

	form.parse(req, (err, fields, files) => {
		if (err) {
			logger.error('文件上传解析错误:', err)
			sendResponse(res, 500, { error: '文件上传失败' })
			return
		}

		// 构建multipart/form-data请求
		const boundary = '----WebKitFormBoundary' + Math.random().toString(16).substr(2)
		const options = {
			hostname: OPENAI_API_HOST,
			port: 443,
			path: req.url,
			method: 'POST',
			headers: {
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				Authorization: req.headers['authorization']
			},
			agent: new HttpsProxyAgent(`http://${proxyIP}`)
		}

		const openaiReq = https.request(options, openaiRes => {
			res.writeHead(openaiRes.statusCode, openaiRes.headers)
			openaiRes.pipe(res)
		})

		openaiReq.on('error', error => {
			logger.error('文件上传到OpenAI API时发生错误:', error)
			sendResponse(res, 500, { error: '文件上传失败' })
		})

		// 写入字段
		for (const field in fields) {
			openaiReq.write(`--${boundary}\r\n` + `Content-Disposition: form-data; name="${field}"\r\n\r\n` + `${fields[field]}\r\n`)
		}

		// 处理文件
		const fileFields = Object.keys(files)
		let processedFiles = 0

		const processFile = fileField => {
			const fileArray = files[fileField]
			if (Array.isArray(fileArray)) {
				fileArray.forEach(file => writeFile(file))
			} else if (fileArray) {
				writeFile(fileArray)
			}
			processedFiles++
			if (processedFiles === fileFields.length) {
				openaiReq.end(`\r\n--${boundary}--\r\n`)
			}
		}

		const writeFile = file => {
			if (file && file.filepath) {
				const fileStream = fs.createReadStream(file.filepath)
				openaiReq.write(
					`--${boundary}\r\n` +
						`Content-Disposition: form-data; name="${file.name}"; filename="${file.originalFilename || 'unknown'}"\r\n` +
						`Content-Type: ${file.mimetype || 'application/octet-stream'}\r\n\r\n`
				)
				fileStream.pipe(openaiReq, { end: false })
				fileStream.on('end', () => {
					openaiReq.write('\r\n')
					if (processedFiles === fileFields.length) {
						openaiReq.end(`--${boundary}--\r\n`)
					}
				})
				fileStream.on('error', error => {
					logger.error('读取文件流时发生错误:', error)
					sendResponse(res, 500, { error: '文件上传失败' })
					openaiReq.destroy()
				})
			}
		}

		if (fileFields.length > 0) {
			fileFields.forEach(processFile)
		} else {
			openaiReq.end(`\r\n--${boundary}--\r\n`)
		}
	})
}

function handleFileDownload(openaiRes, res) {
	res.writeHead(openaiRes.statusCode, openaiRes.headers)
	openaiRes.pipe(res)
}

module.exports = {
	handleRequest
}
