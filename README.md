# Claude API 和 OpenAI API 代理服务

在VPS中部署代理服务，避免意外情况......

## 功能

- 支持 Claude API 和 OpenAI API 的代理
- 自动爬取和验证高质量住宅IP代理
- 动态IP代理池管理
- 并发控制和负载均衡
- IP 黑名单
- 请求速率限制
- 日志记录
- OpenAI realtime Api 支持
- 用户认证和管理界面

## 配置

配置选项可以通过环境变量、命令行参数或默认值设置。优先级顺序为：环境变量 > 命令行参数 > 默认值。

主要配置项包括：

- `BASE_PATH`: 基础路径，用于存储日志和黑名单文件
- `PROXY_PORT`: 代理服务器监听的端口，默认：6543
- `IP_ERROR_THRESHOLD`: IP 错误阈值，默认：10
- `ERROR_WINDOW`: 错误窗口时间（毫秒），默认：1 天
- `RATE_LIMIT_REQUESTS`: 速率限制配置-允许的请求数，默认：100
- `RATE_LIMIT_INTERVAL`: 速率限制配置-时间间隔（毫秒），默认：1 分钟
- `CLAUDE_API_HOST`: Claude API 的主机地址，默认：api.anthropic.com
- `OPENAI_API_HOST`: OpenAI API 的主机地址，默认：api.openai.com
- `PROXY_LIST`: IP代理列表，格式为逗号分隔的IP:端口对，例如：`"1.1.1.1:8080,2.2.2.2:8080"`
- `PROXY_CHECK_INTERVAL`: 代理检查间隔（毫秒），默认：6小时
- `PROXY_REFRESH_INTERVAL`: 代理刷新间隔（毫秒），默认：1小时
- `PROXY_SCRAPER_URLS`: 代理爬取源URL，逗号分隔的列表
- `PROXY_CONCURRENCY_LIMIT`: 代理并发限制，默认：100

## 运行

### 方法 1: 直接运行

1. 克隆项目：`git clone https://github.com/your-username/ai-proxy.git`
2. 安装依赖：`cd ai-proxy && npm install`
3. 配置代理列表和爬虫源（可选）：设置 `PROXY_LIST` 和 `PROXY_SCRAPER_URLS` 环境变量或在命令行参数中提供
4. 启动服务器：`npm start`

### 方法 2: 使用 Docker

1. 克隆项目：`git clone https://github.com/your-username/ai-proxy.git`
2. 进入项目目录：`cd ai-proxy`
3. 构建 Docker 镜像：`docker build -t ai-proxy .`
4. 运行 Docker 容器：

    ```bash
    docker run -d \
        -p 6543:6543 \
        -e BASE_PATH=/app/data \
        -e PROXY_LIST="1.1.1.1:8080,2.2.2.2:8080" \
        -e PROXY_SCRAPER_URLS="https://example-proxy-list1.com,https://example-proxy-list2.com" \
        -e PROXY_CONCURRENCY_LIMIT=200 \
        -v /path/to/your/data:/app/data \
        --name ai-proxy \
        ai-proxy
    ```

    注意：将 `/path/to/your/data` 替换为您想要存储日志和黑名单文件的实际路径，并提供有效的代理列表和爬虫源URL。

## 使用方法

需有一台 VPS，一个域名，将"claude.api.your-domain"、"openai.api.your-domain"映射至 VPS，本项目依赖与 hostname 进行请求区分

1. Claude API 代理：

    - 将请求发送到 `http[s]://claude.api.your-domain.com:PROXY_PORT`
    - 确保包含 `x-api-key` 头部

2. OpenAI API 代理：

    - 将请求发送到 `http[s]://openai.api.your-domain.com:PROXY_PORT`
    - 确保包含 `authorization` 头部

3. 文件上传（仅 OpenAI）：

    - 使用 multipart/form-data 格式
    - 支持多文件上传

4. WebSocket 连接（仅 OpenAI）：
    - 通过 `ws[s]://openai.api.your-domain.com:PROXY_PORT` 建立连接

## 管理界面

本项目现在包含一个带有用户认证的管理界面，用于配置和监控代理服务。

访问管理界面：
1. 打开浏览器，访问 `http://your-domain.com:PROXY_PORT`
2. 使用默认凭据登录：
   - 用户名：admin
   - 密码：123456

在管理界面中，您可以：
- 查看和更新代理配置
- 监控代理池状态
- 更改管理员用户名和密码

注意：首次登录后，强烈建议立即更改默认密码。

## IP 代理池和并发控制

本项目支持动态 IP 代理池功能和自动爬取高质量代理，并实现了并发控制和负载均衡机制。

- 代理列表可以通过 `PROXY_LIST` 环境变量或命令行参数提供
- 项目会自动爬取和验证可以访问OpenAI和Claude的高质量住宅IP
- 爬取的代理源可以通过 `PROXY_SCRAPER_URLS` 环境变量或命令行参数配置
- 代理的有效性会定期检查，无效的代理会被自动移除
- 每个请求都会使用代理池中负载最小的可用代理
- 代理池会定期刷新，保证代理的有效性和多样性
- 并发控制确保不会过度使用单个代理，可通过 `PROXY_CONCURRENCY_LIMIT` 配置

并发能力主要取决于以下因素：
1. 可用代理的数量
2. `PROXY_CONCURRENCY_LIMIT` 的设置
3. 每个代理的性能和稳定性

通过调整 `PROXY_CONCURRENCY_LIMIT`，您可以控制系统的最大并发请求数。默认值为100，但您可以根据您的需求和代理池的大小进行调整。

## 安全性

- IP 黑名单：多次错误请求的 IP 将被自动加入黑名单
- 速率限制：防止单个 IP 发送过多请求
- IP 代理：使用代理池增加匿名性和请求成功率
- 用户认证：管理界面需要用户名和密码登录

## 日志

日志记录包括请求详情、响应时间、令牌使用情况和使用的代理 IP。日志文件存储在 `BASE_PATH/logs` 文件夹中。

## 贡献

欢迎提交 Pull Requests 来改进这个项目。对于重大更改，请先开一个 issue 讨论您想要改变的内容。

## 许可证

[MIT](https://choosealicense.com/licenses/mit/)
