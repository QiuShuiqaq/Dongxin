#ifndef	_Hal_H
#define	_Hal_H

#define USER_FLASH_START    0x08004F00  								// 用户区起始地址（第63页首地址）			   
/*------------------------------------------------------------------------------------*/
#define Test_Pin_High 	GPIO_SetBits(GPIOB, GPIO_Pin_15)		//测试信号引脚
#define Test_Pin_Low    GPIO_ResetBits(GPIOB, GPIO_Pin_15)		//测试信号引脚

#define S_Warm_High		GPIO_SetBits(GPIOB, GPIO_Pin_4)			//强暖高
#define S_Warm_Low		GPIO_ResetBits(GPIOB, GPIO_Pin_4)		//强暖低

#define W_Warm_High		GPIO_SetBits(GPIOB, GPIO_Pin_5)			//弱暖高
#define W_Warm_Low		GPIO_ResetBits(GPIOB, GPIO_Pin_5)		//弱暖低

#define CuiFen_High		GPIO_SetBits(GPIOB, GPIO_Pin_8)			//吹风高
#define CuiFen_Low		GPIO_ResetBits(GPIOB, GPIO_Pin_8)		//吹风低
#define R_CuiFen        GPIO_ReadInputDataBit(GPIOB, GPIO_Pin_8) // 读取状态

#define HuanQi_High		GPIO_SetBits(GPIOB, GPIO_Pin_7)			//换气高
#define HuanQi_Low		GPIO_ResetBits(GPIOB, GPIO_Pin_7)		//换气低

#define ZaoMin_High		GPIO_SetBits(GPIOB, GPIO_Pin_6)			//照明高
#define ZaoMin_Low		GPIO_ResetBits(GPIOB, GPIO_Pin_6)		//照明低

/*------------------------------------------------------------------------------------*/
#define FEN1_H			GPIO_SetBits(GPIOB, GPIO_Pin_0)			//步进电机 粉 高
#define FEN1_L			GPIO_ResetBits(GPIOB, GPIO_Pin_0)		//步进电机 粉 低

#define LAN1_H			GPIO_SetBits(GPIOB, GPIO_Pin_1)			//步进电机 蓝 高
#define LAN1_L			GPIO_ResetBits(GPIOB, GPIO_Pin_1)		//步进电机 蓝 低

#define HUANG1_H		GPIO_SetBits(GPIOB, GPIO_Pin_2)			//步进电机 黄 高
#define HUANG1_L		GPIO_ResetBits(GPIOB, GPIO_Pin_2)		//步进电机 黄 低

#define CHENG1_H		GPIO_SetBits(GPIOB, GPIO_Pin_3)			//步进电机 橙 高
#define CHENG1_L		GPIO_ResetBits(GPIOB, GPIO_Pin_3)		//步进电机 橙 低

/*------------------------------------------------------------------------------------*/
#define RS485_EN_High	GPIO_SetBits(GPIOB, GPIO_Pin_12)		//RS485_EN 高
#define RS485_EN_Low	GPIO_ResetBits(GPIOB, GPIO_Pin_12)		//RS485_EN 低


#define Beep_High		GPIO_SetBits(GPIOB, GPIO_Pin_9)			//蜂鸣器 高
#define Beep_Low		GPIO_ResetBits(GPIOB, GPIO_Pin_9)		//蜂鸣器 低

#define TM1620_STB_High GPIO_SetBits(GPIOA, GPIO_Pin_8)			//显示器STB 高 [PA8]
#define TM1620_STB_Low  GPIO_ResetBits(GPIOA, GPIO_Pin_8)      	//显示器STB 低

#define TM1620_CLK_High GPIO_SetBits(GPIOA, GPIO_Pin_11)		//显示器CLK 高 [PA11]
#define TM1620_CLK_Low	GPIO_ResetBits(GPIOA, GPIO_Pin_11)		//显示器CLK 低

#define TM1620_DIN_High	GPIO_SetBits(GPIOA, GPIO_Pin_12)		//显示器DIN 高 [PA12]
#define TM1620_DIN_Low	GPIO_ResetBits(GPIOA, GPIO_Pin_12)		//显示器DIN 低
/*------------------------------------------------------------------------------------*/

#define RX_Head_H		0x02					//数据头 高位
#define RX_Head_L		0xCF					//数据头 低位

#define RX_End_H		0x0F					//数据尾 高位
#define RX_End_L		0x04					//数据尾 低位

#define TX_Head_H		0x02					//数据头 高位
#define TX_Head_L		0xCA					//数据头 低位

#define TX_End_H		0x0B					//数据尾 高位
#define TX_End_L		0x04					//数据尾 低位

#define Type			0x07					//产品类型定义

#define MOTO_TMR    	80						//步进电机步距间隔时间 uS

#define T_30Min			2
#define T_5Min			2
#define	T_60Min			60
#define	T_55Min			2

#define W_delay_Tmr 	30

#define CuShi_Hot		10				//除湿 热 10 分钟
#define CuShi_Cold		5				//除湿 冷 5  分钟

/*--------------------------------------------------------------------------------*/
enum
{
 White  = 0,		//白色	
 Red    = 1,		//红色
 Green  = 2, 		//绿色
 Blue   = 3,		//蓝色
 Orange = 4,		//橙色
 Cyan   = 5,		//青色
 Purple	= 6,		//紫色
 Black  = 7			//黑色
};	
/*--------------------------------------------------------------------------------*/
enum
{Command_Stat   = 0x00,		//状态查询命令   [11] STATUS	
										//STATUS： bit0 –浴霸灯光开关， 0-关； 1-开
										//         bit1 –浴霸换气开关， 0-关； 1-开
										//	       bit2 –浴霸吹风开关， 0-关； 1-开
										//         bit[3-4] –浴霸风暖开关， 00-关； 01-开弱暖； 10 –开强暖
										//         bit5 –浴霸摆风开关， 0-关； 1-开
										//         bit6 –浴霸除湿开关， 0-关； 1-开
										//         bit7 –预留
	
 Command_Lamp   = 0x01,		//灯光开关命令   [4]SW [5]TIMES [11] STATUS	
										//SW： 0x00 –关闭
										//     0x01 –打开
	
 Command_HuanQi = 0x02,		//换气开关命令   [4]SW [5]TIMES [11] STATUS
										//SW： 0x00 –关闭
										//     0x01 –打开
	
 Command_CuiFen = 0x03,		//吹风开关命令   [4]SW [5]TIMES [11] STATUS
										//SW： 0x00 –关闭
										//     0x01 –打开
	
 Command_Warm   = 0x04,		//暖风开关命令   [4]SW [5]TIMES [11] STATUS
										//SW： 0x00 –关闭
										//     0x01 –打开弱暖风
										//     0x02 –打开强暖风
	
 Command_BaiYei = 0x05,		//摆风开关命令   [4]SW [5]TIMES [11] STATUS
										//SW： 0x00 –关闭
										//     0x01 –打开
	
 Command_CuShi  = 0x06,		//除湿开关命令   [4]SW [5]TIMES [11] STATUS
										//SW： 0x00 –关闭
										//     0x01 –打开
	
 Command_Signal = 0x07,		//指示灯控制命令 [4]SW [5]TIMES [11] STATUS
										//SW： 0x00-关
										//     0x01-开
										//0x02-慢闪， 1s 亮 1s 灭
										//0x03-快闪， 100ms 亮 100ms 灭
	
 Command_Beep   = 0x08,		//蜂鸣器控制命令 [4]SW [5]TIMES [11] STATUS
										//SW： 		0x01 –短叫， 持续时间 100ms
										//		 	0x02 –长叫， 持续时间 500ms
										//TIMES： 鸣叫次数， 每次间隔时间 200ms	
										
 Command_Time   = 0x09, 		//下发开关后的工作时间
										//SW:0~78 步长0F 单位分钟
										
 Command_Rst_Net = 0x0A,		//重置配网 重置 WIFI， 进入配网模式
										//SW： 0x0A –进入配网	
										
 Command_Mode_Set= 0x0B,		//模式设定
										//MODE： 0x01 –进入模式运行状态
										//       0x00 –退出模式运行状态
 Command_En_Net  = 0x0C,		//联网使能
										//EN： 0x01 –使能联网功能
										//0x00 –禁止联网功能
 Command_Net_Stat= 0xA3,		//查询模组网络状态
										//OL： bit0 : 0 –未联网； 1 –已联网
								
 Command_Power = 0x0f		//关机键
};


extern void Pro_Control(unsigned char uart,unsigned char Command,unsigned char SW,unsigned char Bpcount);
extern void Beeping(uint8_t _cout,uint16_t _tmr,uint16_t _interval);		//蜂鸣器鸣叫次数
extern void Check_BLE_Uart1(void);									//BLE   串口数据检测
extern void Check_Homen_Uart2(void);								//鸿蒙  串口数据检测
extern void Check_CI1302_Uart3(void);
extern void Uart_Tx_CI_Event(uint8_t event_type, uint8_t semantic_id, uint8_t event_sequence);
extern void Tim2_Init(void);
extern void TIM4_PWM_Init (void);
extern void TIM3_Cap_Init (void);
extern void Check_RF_Code(void);
extern void Setp_Moto_Pin_Init(void);						//步进电机端口初始化		

extern void Usart1_Init(uint32_t baud);
extern void Usart2_Init(uint32_t baud); 
extern void Usart3_Init(uint32_t baud);

extern void ADC1_Init(void);
extern void GPIO_Init0(void);

extern void Running_Step_Moto(void);
extern uint16_t ADC_ReadSingleChannel(void);
extern uint8_t Conver_Temper(void);

extern void Tim5_Init(void);
extern void IWDG_Init(void);

extern void init_Status(void);						//系统参数初始化	
extern void Sys_Running(void);						//系统端口 处理
extern void CuShi_TMR_Pro(void);					//除湿运行时间
extern void Sys_Time_Count(void);					//机器关机计时

extern void TM1620_Display(void);

extern uint8_t Flash_EraseSector(u32 SectorAddr);             			// 擦除指定扇区（页）
extern void STMFLASH_Read(u32 ReadAddr,u16 *pBuffer,u16 NumToRead);		// 读取FLASH数据
extern void STMFLASH_Write(u32 WriteAddr,u16 *pBuffer,u16 NumToWrite);	// 写入FLASH数据
extern void Test_Write(u32 WriteAddr, u16 WriteData);					// 测试写入FLASH数据

extern void Send_Attch_Net(void);							// 配网查询
extern void Hm_Delay(void);									// 鸿蒙运行时间倒计时
#endif


