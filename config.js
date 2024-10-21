const path = require('path')

function getConfigValue(key, defaultValue) {
	// 首先检查环境变量
	if (process.env[key] !== undefined) {
		return process.env[key]
	}

	// 然后检查命令行参数
	const argIndex = process.argv.indexOf(`--${key}`)
	if (argIndex !== -1 && process.argv[argIndex + 1] !== undefined) {
		return process.argv[argIndex + 1]
	}

	// 如果都没有，使用默认值
	return defaultValue
}

const BASE_PATH = getConfigValue('BASE_PATH', process.cwd())

// 解析PROXY_LIST字符串为数组
function parseProxyList(proxyListString) {
	if (!proxyListString) return [];
	return proxyListString.split(',').map(proxy => proxy.trim());
}

module.exports = {
	BASE_PATH,
	PROXY_PORT: parseInt(getConfigValue('PROXY_PORT', '6543')),
	IP_ERROR_THRESHOLD: parseInt(getConfigValue('IP_ERROR_THRESHOLD', '10')),
	ERROR_WINDOW: parseInt(getConfigValue('ERROR_WINDOW', '86400000')), // 1天的毫秒数
	RATE_LIMIT: {
		REQUESTS: parseInt(getConfigValue('RATE_LIMIT_REQUESTS', '100')),
		INTERVAL: parseInt(getConfigValue('RATE_LIMIT_INTERVAL', '60000')) // 1分钟的毫秒数
	},
	CLAUDE_API_HOST: getConfigValue('CLAUDE_API_HOST', 'api.anthropic.com'),
	OPENAI_API_HOST: getConfigValue('OPENAI_API_HOST', 'api.openai.com'),
	LOG_PATH: path.join(BASE_PATH, 'logs'),
	BLACK_LIST_PATH: path.join(BASE_PATH, 'black.json'),
	PROXY_LIST: parseProxyList(getConfigValue('PROXY_LIST', '')),
	PROXY_CHECK_INTERVAL: parseInt(getConfigValue('PROXY_CHECK_INTERVAL', '21600000')), // 6小时的毫秒数
	PROXY_REFRESH_INTERVAL: parseInt(getConfigValue('PROXY_REFRESH_INTERVAL', '3600000')), // 1小时的毫秒数
	PROXY_SCRAPER_URLS: getConfigValue('PROXY_SCRAPER_URLS', 'https://example-proxy-list.com').split(','),
	PROXY_CONCURRENCY_LIMIT: parseInt(getConfigValue('PROXY_CONCURRENCY_LIMIT', '100')),
}
