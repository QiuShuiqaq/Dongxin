#include "stm32f10x.h"
#include "stm32f10x_flash.h"
#include <stdio.h>


//typedef enum {
//  FLASH_BUSY = 1,        // 对应 FLASH_STATUS_BSY，Flash忙
//  FLASH_ERROR_PG,        // 编程错误
//  FLASH_ERROR_WRP,       // 写保护错误
//  FLASH_COMPLETE,        // 对应 FLASH_STATUS_OK，操作完成
//  FLASH_TIMEOUT          // 操作超时
//} FLASH_Status;

// -------------------------- 核心宏定义（适配STM32F103C8T6） --------------------------
#define STM32_FLASH_SIZE    64          // 芯片Flash容量：64KB（中容量型号）
#define STM32_FLASH_WREN    1           // 使能Flash写入（1=使能，0=禁用）
#define STM32_FLASH_BASE    0x08000000  // Flash起始地址
#define STM_SECTOR_SIZE     1024        // 扇区大小：1KB（中容量芯片固定）

// 用户Flash操作区（最后1页，避开程序存储区）
//#define USER_FLASH_START    0x0800F000  // 用户区起始地址（第63页首地址）
//#define USER_FLASH_START    0x08003F00  // 用户区起始地址（第63页首地址）
#define USER_FLASH_END      0x08010000  // 用户区结束地址（Flash总上限）

// 数据缓冲区（避免"TEXT_Buff未定义"错误）
#define BUF_SIZE            50          // 缓冲区大小（半字数，对应100字节）
uint16_t TEXT_Buff[BUF_SIZE] = {0};     // 通用数据缓冲区（读写共用）

// -------------------------- 函数声明（避免隐式声明警告） --------------------------
u16 STMFLASH_ReadHalfWord(u32 faddr);                  // 读取16位半字
void STMFLASH_Write(u32 WriteAddr, u16 *pBuffer, u16 NumToWrite); // 写入指定长度数据
void STMFLASH_Read(u32 ReadAddr, u16 *pBuffer, u16 NumToRead);   // 读取指定长度数据
void Test_Write(u32 WriteAddr, u16 WriteData);         // 单数据写入测试
uint8_t Flash_EraseSector(u32 SectorAddr);             // 擦除指定扇区（页）

// -------------------------- 函数实现 --------------------------
/**
 * @brief  读取指定地址的16位半字
 * @param  faddr：读取地址（必须半字对齐，偶数地址）
 * @retval 读取到的16位数据
 */
u16 STMFLASH_ReadHalfWord(u32 faddr) {
    return *(vu16*)faddr;  // 内存映射直接访问
}

/**
 * @brief  擦除指定扇区（页）
 * @param  SectorAddr：扇区起始地址（必须是页首地址）
 * @retval 0=成功，1=忙，2=擦除失败
 */
uint8_t Flash_EraseSector(u32 SectorAddr) {
    // 检查Flash是否忙碌
    if (FLASH_GetStatus() == FLASH_BUSY) {
        return 1;
    }

    FLASH_Unlock();                          // 解锁Flash
    FLASH_ClearFlag(FLASH_FLAG_EOP | FLASH_FLAG_PGERR | FLASH_FLAG_WRPRTERR); // 清除错误标志
    FLASH_ErasePage(SectorAddr);             // 擦除指定页
    FLASH_Lock();                            // 锁定Flash

    // 检查擦除结果
    if (FLASH_GetStatus() != FLASH_COMPLETE) {
        return 2;
    }
    return 0;
}

/**
 * @brief  无检查写入（内部辅助函数，不对外暴露）
 */
static void STMFLASH_Write_NoCheck(u32 WriteAddr, u16 *pBuffer, u16 NumToWrite) {
    u16 i;
    for (i = 0; i < NumToWrite; i++) {
        FLASH_ProgramHalfWord(WriteAddr, pBuffer[i]);  // 标准库半字写入
        WriteAddr += 2;  // 地址偏移2字节（半字对齐）
    }
}

/**
 * @brief  带扇区擦除的安全写入（自动处理跨扇区、数据备份）
 * @param  WriteAddr：起始地址（半字对齐）
 * @param  pBuffer：数据指针
 * @param  NumToWrite：写入半字个数
 */
void STMFLASH_Write(u32 WriteAddr, u16 *pBuffer, u16 NumToWrite) {
    u32 secpos;      // 扇区地址
    u16 secoff;      // 扇区内偏移（半字计数）
    u16 secremain;   // 扇区剩余半字个数
    u16 i;
    u32 offaddr;     // 相对于Flash起始地址的偏移

    // 非法地址检查
    if (WriteAddr < STM32_FLASH_BASE || WriteAddr >= (STM32_FLASH_BASE + 1024 * STM32_FLASH_SIZE)) {
        return;
    }

    FLASH_Unlock();                          // 解锁
    offaddr = WriteAddr - STM32_FLASH_BASE;  // 计算偏移地址
    secpos = offaddr / STM_SECTOR_SIZE;      // 计算所在扇区
    secoff = (offaddr % STM_SECTOR_SIZE) / 2;// 计算扇区内偏移（半字为单位）
    secremain = (STM_SECTOR_SIZE / 2) - secoff; // 扇区剩余半字个数

    // 调整写入长度（不超过当前扇区剩余空间）
    if (NumToWrite <= secremain) {
        secremain = NumToWrite;
    }

    while (1) {
        // 读取当前扇区所有数据到缓冲区（备份原有数据）
        STMFLASH_Read(secpos * STM_SECTOR_SIZE + STM32_FLASH_BASE, TEXT_Buff, STM_SECTOR_SIZE / 2);

        // 检查扇区是否需要擦除（存在非0xFFFF的数据）
        for (i = 0; i < secremain; i++) {
            if (TEXT_Buff[secoff + i] != 0xFFFF) {
                break;  // 需要擦除
            }
        }

        FLASH_ClearFlag(FLASH_FLAG_EOP | FLASH_FLAG_PGERR | FLASH_FLAG_WRPRTERR);
        if (i < secremain) {
            // 擦除当前扇区
            if (Flash_EraseSector(secpos * STM_SECTOR_SIZE + STM32_FLASH_BASE) != 0) {
                FLASH_Lock();
                return;
            }
            // 复制新数据到缓冲区（覆盖原有偏移位置）
            for (i = 0; i < secremain; i++) {
                TEXT_Buff[secoff + i] = pBuffer[i];
            }
            // 写入整个扇区（含备份数据+新数据）
            STMFLASH_Write_NoCheck(secpos * STM_SECTOR_SIZE + STM32_FLASH_BASE, TEXT_Buff, STM_SECTOR_SIZE / 2);
        } else {
            // 扇区已擦除，直接写入新数据
            STMFLASH_Write_NoCheck(WriteAddr, pBuffer, secremain);
        }

        // 检查是否写入完成
        if (NumToWrite == secremain) {
            break;
        } else {
            // 跨扇区处理：更新参数，继续写入下一扇区
            secpos++;          // 扇区地址+1
            secoff = 0;        // 偏移归零
            pBuffer += secremain;  // 数据指针偏移
            WriteAddr += secremain * 2;  // 写入地址偏移
            NumToWrite -= secremain;     // 剩余写入个数递减
            // 调整下一扇区写入长度
            secremain = (NumToWrite > (STM_SECTOR_SIZE / 2)) ? (STM_SECTOR_SIZE / 2) : NumToWrite;
        }
    }

    FLASH_Lock();  // 操作完成锁定Flash
}

/**
 * @brief  读取指定长度数据
 * @param  ReadAddr：起始地址（半字对齐）
 * @param  pBuffer：数据接收缓冲区
 * @param  NumToRead：读取半字个数
 */
void STMFLASH_Read(u32 ReadAddr, u16 *pBuffer, u16 NumToRead) {
    u16 i;
    for (i = 0; i < NumToRead; i++) {
        pBuffer[i] = STMFLASH_ReadHalfWord(ReadAddr);  // 逐半字读取
        ReadAddr += 2;  // 地址偏移2字节
    }
}

/**
 * @brief  单数据写入测试（写入1个16位数据）
 * @param  WriteAddr：写入地址，WriteData：待写入数据
 */
void Test_Write(u32 WriteAddr, u16 WriteData) {
    STMFLASH_Write(WriteAddr, &WriteData, 1);
}

	
	
//////////////////////////////////////////////////////////////////////////////////////////////////////


























