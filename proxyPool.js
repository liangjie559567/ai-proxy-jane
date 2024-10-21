const axios = require('axios');
const ProxyScraperService = require('./proxyScraperService');

class ProxyPool {
    constructor(config) {
        this.config = config;
        this.proxies = [];
        this.proxyUsage = new Map();
        this.proxyScraperService = new ProxyScraperService(config);
        this.concurrencyLimit = config.PROXY_CONCURRENCY_LIMIT || 100;
        this.activeRequests = 0;
    }

    async initialize() {
        await this.refreshProxies();
        setInterval(() => this.refreshProxies(), this.config.PROXY_REFRESH_INTERVAL);
    }

    async refreshProxies() {
        const scrapedProxies = await this.proxyScraperService.getValidProxies();
        const configProxies = this.config.PROXY_LIST.split(',').map(proxy => proxy.trim());
        this.proxies = [...new Set([...scrapedProxies, ...configProxies])];
        await this.validateProxies();
        this.proxyUsage.clear();
        this.proxies.forEach(proxy => this.proxyUsage.set(proxy, 0));
        console.log(`Refreshed proxy pool. Total valid proxies: ${this.proxies.length}`);
    }

    async validateProxies() {
        const validProxies = [];
        for (const proxy of this.proxies) {
            if (await this.validateProxy(proxy)) {
                validProxies.push(proxy);
            }
        }
        this.proxies = validProxies;
    }

    async validateProxy(proxy) {
        try {
            await axios.get('https://api.ipify.org', {
                proxy: {
                    host: proxy.split(':')[0],
                    port: proxy.split(':')[1]
                },
                timeout: 5000
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    async getNextProxy() {
        if (this.proxies.length === 0) {
            throw new Error('No valid proxies available');
        }

        // Wait if we've reached the concurrency limit
        while (this.activeRequests >= this.concurrencyLimit) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Find the least used proxy
        let leastUsedProxy = this.proxies[0];
        let leastUsage = this.proxyUsage.get(leastUsedProxy) || 0;

        for (const proxy of this.proxies) {
            const usage = this.proxyUsage.get(proxy) || 0;
            if (usage < leastUsage) {
                leastUsedProxy = proxy;
                leastUsage = usage;
            }
        }

        this.proxyUsage.set(leastUsedProxy, leastUsage + 1);
        this.activeRequests++;

        return leastUsedProxy;
    }

    releaseProxy(proxy) {
        this.activeRequests--;
        const usage = this.proxyUsage.get(proxy) || 1;
        this.proxyUsage.set(proxy, usage - 1);
    }

    getCurrentConcurrency() {
        return this.activeRequests;
    }

    getTotalProxies() {
        return this.proxies.length;
    }

    getActiveProxies() {
        return this.proxies.filter(proxy => this.proxyUsage.get(proxy) > 0).length;
    }
}

module.exports = ProxyPool;
