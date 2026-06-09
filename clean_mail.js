/**
 * 邮箱清理工具
 */
import Imap from 'imap';

const MAIL_PASSWORD = '';

/**
 * 清空指定邮箱的收件箱和垃圾箱中的所有邮件
 * @param {string} emailAddress - 邮箱地址
 * @returns {Promise<Object>} 返回清理结果，包含删除的邮件数量
 */
export const cleanMailbox = async (emailAddress) => {
    return new Promise((resolve, reject) => {
        // 解析邮箱地址
        const [username, domain] = emailAddress.split('@');

        // IMAP配置
        const imapConfig = {
            user: emailAddress,
            password: MAIL_PASSWORD,
            host: 'server.cloudcone.email',
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false }
        };

        const imap = new Imap(imapConfig);
        const result = {
            email: emailAddress,
            inboxDeleted: 0,
            spamDeleted: 0,
            errors: []
        };

        console.log(`\n开始清理邮箱: ${emailAddress}`);

        // 连接IMAP服务器
        imap.once('ready', () => {
            console.log(`已连接到IMAP服务器`);

            // 先清理收件箱
            cleanFolder(imap, 'INBOX')
                .then((inboxCount) => {
                    result.inboxDeleted = inboxCount;
                    console.log(`收件箱已清理 ${inboxCount} 封邮件`);

                    // 再清理垃圾箱
                    return cleanFolder(imap, 'Spam');
                })
                .then((spamCount) => {
                    result.spamDeleted = spamCount;
                    console.log(`垃圾箱已清理 ${spamCount} 封邮件`);
                    console.log(`邮箱 ${emailAddress} 清理完成`);
                    imap.end();
                    resolve(result);
                })
                .catch((error) => {
                    console.error(`清理邮箱时出错: ${error.message}`);
                    result.errors.push(error.message);
                    imap.end();
                    resolve(result);
                });
        });

        imap.once('error', (err) => {
            console.error(`IMAP连接错误: ${err.message}`);
            reject(new Error(`IMAP连接失败: ${err.message}`));
        });

        imap.once('end', () => {
            console.log(`IMAP连接已关闭`);
        });

        imap.connect();
    });
};

/**
 * 清理指定文件夹中的所有邮件
 * @param {Imap} imap - IMAP实例
 * @param {string} folderName - 文件夹名称（INBOX或Spam）
 * @returns {Promise<number>} 返回删除的邮件数量
 */
const cleanFolder = (imap, folderName) => {
    return new Promise((resolve, reject) => {
        console.log(`正在打开 ${folderName} 文件夹...`);

        imap.openBox(folderName, false, (err, box) => {
            if (err) {
                console.warn(`无法打开 ${folderName} 文件夹: ${err.message}`);
                resolve(0);
                return;
            }

            const messageCount = box.messages.total;
            console.log(`${folderName} 中共有 ${messageCount} 封邮件`);

            if (messageCount === 0) {
                console.log(`${folderName} 为空，无需清理`);
                resolve(0);
                return;
            }

            // 搜索所有邮件
            imap.search(['ALL'], (err, results) => {
                if (err) {
                    console.error(`搜索邮件失败: ${err.message}`);
                    reject(err);
                    return;
                }

                if (!results || results.length === 0) {
                    console.log(`${folderName} 中没有找到邮件`);
                    resolve(0);
                    return;
                }

                console.log(`准备删除 ${results.length} 封邮件...`);

                // 标记邮件为删除
                imap.addFlags(results, '\\Deleted', (err) => {
                    if (err) {
                        console.error(`标记删除失败: ${err.message}`);
                        reject(err);
                        return;
                    }

                    console.log(`已标记 ${results.length} 封邮件为删除`);

                    // 执行删除操作
                    imap.expunge((err) => {
                        if (err) {
                            console.error(`执行删除失败: ${err.message}`);
                            reject(err);
                            return;
                        }

                        console.log(`已成功删除 ${folderName} 中的 ${results.length} 封邮件`);
                        resolve(results.length);
                    });
                });
            });
        });
    });
};