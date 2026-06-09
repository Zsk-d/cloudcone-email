import fetch from 'node-fetch';
import { getMailList, getMailUsage, exportMailToCsv } from './get_mail_usage.js';
import { cleanMailbox } from './clean_mail.js';
import fs from 'fs';
import csvParser from 'csv-parser';

const cloudcone_secret = ''
const cloudcone_hash = ''

// 线程数配置
const THREAD_COUNT = 4;

const fetchUrl = async (method, url, options, data) => {
    return new Promise((resolve, reject) => {
        const _options = {
            method,
            headers: {
                accept: 'application/json',
                ...{
                    'App-Secret': cloudcone_secret,
                    Hash: cloudcone_hash
                }
            },
            body: data
        };

        options = Object.assign(options, _options)
        fetch(url, options)
            .then(res => res.json())
            .then(json => resolve(json))
            .catch(err => reject(new Error(err)));
    });
}

export const getDomainInfo = async (id) => {
    const url = `https://api.cloudcone.com/api/v2/email/domain/${id}/info`;
    return await fetchUrl('GET', url, {}, null)
}

/**
 * 从CSV文件中读取邮箱数据，筛选出大于指定大小的邮箱并进行清理
 * @param {string} csvFilePath - CSV文件路径
 * @param {number} thresholdMB - 阈值（MB），默认5MB
 * @returns {Promise<void>}
 */
export const cleanLargeMailboxes = async (csvFilePath, thresholdMB = 5) => {
    console.log(`\n=== 开始清理大于 ${thresholdMB} MB 的邮箱 ===`);
    console.log(`读取文件: ${csvFilePath}`);

    // 读取CSV文件
    const mailboxes = await readCsvFile(csvFilePath);
    console.log(`共读取 ${mailboxes.length} 条邮箱数据`);

    // 筛选出大于阈值的邮箱
    const largeMailboxes = mailboxes.filter(item => {
        // 只处理单位为MB且数值大于阈值的邮箱
        // 同时排除已经成功清理过的邮箱
        return item.usageUnit === 'MB' && 
               item.usageValue > thresholdMB && 
               item.cleanStatus !== 'success';
    });

    console.log(`筛选出 ${largeMailboxes.length} 个需要清理的邮箱（>${thresholdMB} MB，未清理）`);
    
    // 统计已清理的数量
    const alreadyCleaned = mailboxes.filter(item => item.cleanStatus === 'success').length;
    if (alreadyCleaned > 0) {
        console.log(`已跳过 ${alreadyCleaned} 个已清理的邮箱`);
    }

    if (largeMailboxes.length === 0) {
        console.log('没有需要清理的邮箱');
        return;
    }

    // 显示需要清理的邮箱列表
    console.log('\n需要清理的邮箱列表：');
    largeMailboxes.forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.mail} - ${item.usageValue} MB`);
    });

    // 逐个清理邮箱
    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (let i = 0; i < largeMailboxes.length; i++) {
        const mailbox = largeMailboxes[i];
        console.log(`\n[${i + 1}/${largeMailboxes.length}] 正在清理: ${mailbox.mail}`);

        try {
            // 执行清理
            const cleanResult = await cleanMailbox(mailbox.mail);
            
            // 记录清理结果
            const totalDeleted = cleanResult.inboxDeleted + cleanResult.spamDeleted;
            mailbox.cleanStatus = totalDeleted > 0 ? 'success' : 'empty';
            mailbox.inboxDeleted = cleanResult.inboxDeleted;
            mailbox.spamDeleted = cleanResult.spamDeleted;
            mailbox.cleanTime = new Date().toISOString();
            
            console.log(`✓ 清理完成: 收件箱删除 ${cleanResult.inboxDeleted} 封，垃圾箱删除 ${cleanResult.spamDeleted} 封`);
            successCount++;
            results.push(mailbox);
        } catch (error) {
            console.error(`✗ 清理失败: ${error.message}`);
            mailbox.cleanStatus = 'failed';
            mailbox.cleanError = error.message;
            mailbox.cleanTime = new Date().toISOString();
            failCount++;
            results.push(mailbox);
        }

        // 每处理一个邮箱后更新CSV文件
        await updateCsvFile(csvFilePath, mailboxes);
        console.log(`已更新CSV文件进度`);
    }

    console.log(`\n=== 清理完成 ===`);
    console.log(`成功: ${successCount}, 失败: ${failCount}`);
    console.log(`最终结果已保存到: ${csvFilePath}`);
};

/**
 * 读取CSV文件
 * @param {string} filePath - CSV文件路径
 * @returns {Promise<Array>} 邮箱数据数组
 */
const readCsvFile = (filePath) => {
    return new Promise((resolve, reject) => {
        const results = [];
        
        fs.createReadStream(filePath)
            .pipe(csvParser({
                headers: ['id', 'mail', 'usageValue', 'usageUnit', 'cleanStatus', 'inboxDeleted', 'spamDeleted', 'cleanTime', 'cleanError']
            }))
            .on('data', (row) => {
                // 转换数值类型
                row.usageValue = parseFloat(row.usageValue) || 0;
                results.push(row);
            })
            .on('end', () => {
                resolve(results);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
};

/**
 * 更新CSV文件，保留所有数据并添加清理状态
 * @param {string} filePath - CSV文件路径
 * @param {Array} mailboxes - 邮箱数据数组
 * @returns {Promise<void>}
 */
const updateCsvFile = (filePath, mailboxes) => {
    return new Promise((resolve, reject) => {
        // CSV头部
        const csvHeaders = ['邮箱ID', '邮箱地址', '占用空间数值', '占用空间单位', '清理状态', '收件箱删除数', '垃圾箱删除数', '清理时间', '错误信息'];
        
        // 构建CSV内容
        let csvContent = csvHeaders.join(',') + '\n';
        
        // 添加数据行
        mailboxes.forEach(item => {
            const row = [
                item.id,
                item.mail,
                item.usageValue,
                item.usageUnit,
                item.cleanStatus || '',
                item.inboxDeleted || '',
                item.spamDeleted || '',
                item.cleanTime || '',
                item.cleanError || ''
            ];
            csvContent += row.join(',') + '\n';
        });

        // 写入文件
        try {
            fs.writeFileSync(filePath, csvContent, 'utf-8');
            resolve();
        } catch (error) {
            reject(error);
        }
    });
};

const func = async () => {

    // const url = `https://api.cloudcone.com/api/v2/email/{}/info`;
    // let res = await fetchUrl('GET', url, {}, null)
    // // // console.log(res)

    // let domainList = []
    // let list = res.__data.domains
    // for (let i = 0; i < list.length; i++) {
    //     let item = list[i]
    //     let info = await getDomainInfo(item.id)
    //     let { id: domainId, name, usage } = info.__data
    //     domainList.push({
    //         id: domainId,
    //         name,
    //         usage: (usage / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    //     })
    //     // console.log(`id: ${domainId}, name: ${name}, usage: ${(usage/1024/1024/1024).toFixed(2)}GB`)
    // }
    // console.log(domainList)

    // 测试 getMailUsage 方法
    console.log('\n=== Testing getMailUsage ===');
    let domainIdList = []
    for (let i = 0; i < domainIdList.length; i++) {
        //     let domain = domainList[i];
        // console.log(`开始处理域名 ${domain.name}`);
        let domainId = domainIdList[i]
        let data = []
        try {
            const mailList = await getMailList(domainId);

            console.log(`\n开始处理 ${mailList.length} 个邮箱，使用 ${THREAD_COUNT} 个线程`);

            // 将邮箱列表平均分配到各个线程
            const chunkSize = Math.ceil(mailList.length / THREAD_COUNT);
            const chunks = [];
            for (let i = 0; i < mailList.length; i += chunkSize) {
                chunks.push(mailList.slice(i, i + chunkSize));
            }

            // 创建所有线程任务
            const threadPromises = chunks.map(async (chunk, threadIndex) => {
                console.log(`线程 ${threadIndex + 1} 开始处理 ${chunk.length} 个邮箱`);
                const threadData = [];

                for (let index = 0; index < chunk.length; index++) {
                    const element = chunk[index];
                    let value, unit;

                    try {
                        let result = await getMailUsage(element.id);
                        value = result.value;
                        unit = result.unit;
                    } catch (error) {
                        console.error(`[线程 ${threadIndex + 1}] 获取 ${element.mail} 使用空间失败: ${error.message}`);
                        value = -1;
                        unit = '';
                    }

                    // 统一转换为MB
                    const unitToMB = {
                        'B': 1 / 1024 / 1024,
                        'KB': 1 / 1024,
                        'MB': 1,
                        'GB': 1024,
                        'TB': 1024 * 1024
                    };
                    const usageInMB = value === -1 ? -1 : value * (unitToMB[unit.toUpperCase()] || 1);

                    if (value === -1) {
                        console.log(`[线程 ${threadIndex + 1}] ${element.mail} : 获取失败 (-1 MB)`);
                    } else {
                        console.log(`[线程 ${threadIndex + 1}] ${element.mail} : ${usageInMB.toFixed(2)} MB (原始: ${value} ${unit})`);
                    }

                    threadData.push({
                        id: element.id,
                        mail: element.mail,
                        usageValue: value === -1 ? -1 : parseFloat(usageInMB.toFixed(2)),
                        usageUnit: value === -1 ? '' : 'MB'
                    })

                    // 每完成5%输出一次进度
                    const progress = ((index + 1) / chunk.length) * 100;
                    const currentPercent = Math.floor(progress);
                    if (currentPercent > 0 && currentPercent % 5 === 0 && (index === chunk.length - 1 || Math.floor(((index + 2) / chunk.length) * 100) !== currentPercent)) {
                        console.log(`[线程 ${threadIndex + 1}] 进度: ${currentPercent}% (${index + 1}/${chunk.length})`);
                    }
                }

                console.log(`线程 ${threadIndex + 1} 完成`);
                return threadData;
            });

            // 等待所有线程完成
            const results = await Promise.all(threadPromises);

            // 合并所有线程的结果
            data = results.flat();

            // 按尺寸倒序排列（从大到小）
            data.sort((a, b) => b.usageValue - a.usageValue);

            // 获取域名信息用于文件名
            const domainInfo = await getDomainInfo(domainId);
            const domainName = domainInfo.__data.name || 'unknown';

            // 导出CSV文件
            const csvPath = await exportMailToCsv(domainName, domainId, data);
            console.log(`\n所有线程已完成`);
            console.log(`CSV文件已导出: ${csvPath}`);
            console.log(`共导出 ${data.length} 条邮箱数据`);

        } catch (error) {
            console.error('Failed to get mail usage:', error.message);
        }
        // console.log(data)
    }
}

// 执行清理功能
cleanLargeMailboxes('12411_7cace.com.csv', 5);

// func()