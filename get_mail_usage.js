import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import path from 'path';

/**
 * 获取邮件使用数据
 * @param {string|number} domainId - 域名ID
 * @returns {Promise<Array<{mail: string, id: string}>>} 邮件数据列表
 */
export async function getMailList(domainId) {
    const url = `https://app.cloudcone.com/email/${domainId}/domain`;

    const headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'cookie': '',
        'dnt': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
        'referer': 'https://app.cloudcone.com',
        'priority': 'u=0, i'
    };

    try {
        // 创建代理代理实例
        const proxyAgent = new HttpsProxyAgent('http://127.0.0.1:10809');

        // 发送HTTP请求获取HTML文档
        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            agent: proxyAgent
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // 获取HTML内容
        const html = await response.text();

        // 使用cheerio解析HTML
        const $ = cheerio.load(html);

        // 提取数据
        const result = [];

        // 选择所有表格行
        $('#accounts > div.table-responsive > table > tbody > tr').each((index, element) => {
            // 提取mail字段
            const mail = $(element).find('td:nth-child(2)').text().trim();

            // 提取id字段
            const href = $(element).find('td.td-actions.text-right > a').attr('href');

            if (mail && href) {
                // 从 '/email/{id}/account' 格式中提取id
                const match = href.match(/\/email\/(\d+)\/account/);
                if (match && match[1]) {
                    result.push({
                        mail: mail,
                        id: match[1]
                    });
                }
            }
        });

        return result;
    } catch (error) {
        console.error('Error fetching mail usage:', error);
        throw error;
    }
}

export async function getMailUsage(mailId) {
    const url = `https://app.cloudcone.com/email/${mailId}/account`;

    const headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'cookie': '',
        'dnt': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
        'referer': `https://app.cloudcone.com/email/${mailId}/manage`,
        'priority': 'u=0, i'
    };

    try {
        // 创建代理实例
        const proxyAgent = new HttpsProxyAgent('http://127.0.0.1:10809');

        // 发送HTTP请求获取HTML文档
        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            agent: proxyAgent
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // 获取HTML内容
        const html = await response.text();

        // 使用cheerio解析HTML
        const $ = cheerio.load(html);

        // 提取空间使用信息
        // 选择器: body > div.wrapper > div.section.section-gray-nude > div > div:nth-child(2) > div:nth-child(3) > div > div > h4
        const usageText = $('body > div.wrapper > div.section.section-gray-nude > div > div:nth-child(2) > div:nth-child(3) > div > div > h4').text().trim();

        if (!usageText) {
            throw new Error('无法获取邮箱使用空间信息');
        }

        // 解析文本，支持多种格式：
        // 格式1: "(3.45 MB, 401.08 KB...)" - 带括号
        // 格式2: "17.99 MB" - 直接数值和单位
        let match = usageText.match(/([\d.]+)\s*(B|MB|KB|GB|TB)/i);


        if (!match) {
            throw new Error(`无法解析空间信息: ${usageText}`);
        }

        return {
            value: parseFloat(match[1]),
            unit: match[2].toUpperCase()
        };
    } catch (error) {
        console.error('Error fetching mail usage:', error);
        throw error;
    }
}

/**
 * 导出邮箱数据为CSV文件
 * @param {string} domainName - 域名名称
 * @param {string|number} domainId - 域名ID
 * @param {Array<{id: string, mail: string, usageValue: number, usageUnit: string}>} list - 邮箱数据列表
 * @returns {Promise<string>} CSV文件路径
 */
export async function exportMailToCsv(domainName, domainId, list) {
    // 生成文件名：域名_域名ID.csv
    const fileName = `${domainId}_${domainName}.csv`;
    const filePath = path.join(process.cwd(), fileName);

    // CSV头部
    const csvHeaders = ['邮箱ID', '邮箱地址', '占用空间数值', '占用空间单位'];

    // 构建CSV内容
    let csvContent = csvHeaders.join(',') + '\n';

    // 添加数据行
    list.forEach(item => {
        const row = [
            item.id,
            item.mail,
            item.usageValue,
            item.usageUnit
        ];
        csvContent += row.join(',') + '\n';
    });

    // 写入文件
    try {
        fs.writeFileSync(filePath, csvContent, 'utf-8');
        console.log(`CSV文件已导出: ${filePath}`);
        return filePath;
    } catch (error) {
        console.error('导出CSV文件失败:', error);
        throw error;
    }
}