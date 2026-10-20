
#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"




/*******************************************************************************************************
                                                串口1 初始化
 配置PA9为USART1 TX（推挽复用输出）								 
 配置PA10为USART1 RX（上拉输入）
*******************************************************************************************************/ 
void Usart1_Init(uint32_t baud) 
{
 GPIO_InitTypeDef gpio_initstruct;						// IO 配置结构体
 USART_InitTypeDef usart_initstruct;					// 串口配置结构体	
 NVIC_InitTypeDef NVIC_InitStructure; 					// 中断优先级配置结构体

//------------------------------ 开启GPIOA和USART1时钟------------------------------------------------//
 RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA | RCC_APB2Periph_USART1, ENABLE);

//------------------------------------ 配置 IO 参数---------------------------------------------------//
 gpio_initstruct.GPIO_Pin   = GPIO_Pin_9;
 gpio_initstruct.GPIO_Mode  = GPIO_Mode_AF_PP;			// 配置PA9为USART1 TX（推挽复用输出）
 gpio_initstruct.GPIO_Speed = GPIO_Speed_50MHz;			// 
 GPIO_Init(GPIOA, &gpio_initstruct);					// 初始化 PA9
												
 gpio_initstruct.GPIO_Pin  = GPIO_Pin_10;
 gpio_initstruct.GPIO_Mode = GPIO_Mode_IPU ;    		// 配置PA10为USART1 RX（上拉输入） 
 GPIO_Init(GPIOA, &gpio_initstruct);					// 初始化 PA10

//------------------------------------ Usart1 NVIC 配置----------------------------------------------//
 NVIC_InitStructure.NVIC_IRQChannel                     = USART1_IRQn;			// 串口1中断通道
 NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority   = 2;					// 抢占优先级 2
 NVIC_InitStructure.NVIC_IRQChannelSubPriority          = 0; 					// 子优先级 0
 NVIC_InitStructure.NVIC_IRQChannelCmd                  = ENABLE; 				// IRQ 通道使能
 NVIC_Init (&NVIC_InitStructure);                      							// 根据指定的参数初始化 VIC 寄存器
	
//------------------------------------ 配置USART1参数------------------------------------------------//
 usart_initstruct.USART_BaudRate            = baud;								// 波特率
 usart_initstruct.USART_WordLength          = USART_WordLength_8b;				// 字长为8位数据格式
 usart_initstruct.USART_StopBits            = USART_StopBits_1;					// 1位停止位
 usart_initstruct.USART_Parity              = USART_Parity_No;					// 无奇偶校验位
 usart_initstruct.USART_HardwareFlowControl = USART_HardwareFlowControl_None;	// 无硬件数据流控制
 usart_initstruct.USART_Mode = USART_Mode_Rx | USART_Mode_Tx;					// 收发模式
 USART_Init(USART1, &usart_initstruct);											// 初始化串口1
 USART_Cmd (USART1, ENABLE); 													// 启用USART1
 
 USART_ITConfig (USART1, USART_IT_RXNE, ENABLE);								// 开启串口1接收中断 
}

/*******************************************************************************************************
                                                串口2 初始化
 配置PA2 为USART2 TX（推挽复用输出）								 
 配置PA3 为USART2 RX（上拉输入）
*******************************************************************************************************/
void Usart2_Init(uint32_t baud) 
{
 GPIO_InitTypeDef gpio_initstruct;									// IO 配置结构体
 USART_InitTypeDef usart_initstruct;								// 串口配置结构体	
 NVIC_InitTypeDef NVIC_InitStructure; 								// 中断优先级配置结构体

//------------------------------ 开启GPIOA和USART2时钟------------------------------------------------//
 RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA,  ENABLE);				// 启用 GPIOA  的时钟
 RCC_APB1PeriphClockCmd(RCC_APB1Periph_USART2, ENABLE); 			// 启用 USART2 的时钟
//------------------------------------ 配置 IO 参数---------------------------------------------------//
 gpio_initstruct.GPIO_Pin 		= GPIO_Pin_2;						// 配置 TX (PA2)
 gpio_initstruct.GPIO_Speed 	= GPIO_Speed_50MHz;
 gpio_initstruct.GPIO_Mode 		= GPIO_Mode_AF_PP; 					// 复用推挽输出
 GPIO_Init(GPIOA, &gpio_initstruct);								// 初始化 PA2

 gpio_initstruct.GPIO_Pin 		= GPIO_Pin_3;						// 配置 RX (PA3)
 gpio_initstruct.GPIO_Mode 		= GPIO_Mode_IPU;					// （上拉输入） 
 GPIO_Init(GPIOA, &gpio_initstruct);								// 初始化 PA3

//------------------------------------ Usart2 NVIC 配置----------------------------------------------//
 NVIC_InitStructure.NVIC_IRQChannel 				 = USART2_IRQn;	// 串口2中断通道
 NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority= 2;			// 抢占优先级 2
 NVIC_InitStructure.NVIC_IRQChannelSubPriority 		 = 0;			// 子优先级 0
 NVIC_InitStructure.NVIC_IRQChannelCmd 				 = ENABLE;		// IRQ 通道使能
 NVIC_Init(&NVIC_InitStructure);									// 根据指定的参数初始化 VIC 寄存器			
	
//------------------------------------ 配置USART2参数------------------------------------------------//	
 usart_initstruct.USART_BaudRate 	= baud; 						// 波特率
 usart_initstruct.USART_WordLength 	= USART_WordLength_8b; 			// 数据位 8 位
 usart_initstruct.USART_StopBits 	= USART_StopBits_1; 			// 停止位 1 位
 usart_initstruct.USART_Parity 		= USART_Parity_No; 				// 无校验位
 usart_initstruct.USART_HardwareFlowControl = USART_HardwareFlowControl_None; // 无硬件流控
 usart_initstruct.USART_Mode 		= USART_Mode_Rx | USART_Mode_Tx;// 收发模式
 USART_Init(USART2, &usart_initstruct);								// 初始化串口2
 USART_Cmd(USART2, ENABLE); 										// 启用 USART2

 USART_ITConfig (USART2, USART_IT_RXNE, ENABLE);					// 开启串口2接收中断  
}

/*******************************************************************************************************
                                                串口3 初始化
 配置PB10 为USART3 TX（推挽复用输出）								 
 配置PB11 为USART3 RX（上拉输入）
*******************************************************************************************************/ 
void Usart3_Init(uint32_t baud) 
{
 GPIO_InitTypeDef gpio_initstruct;									// IO 配置结构体
 USART_InitTypeDef usart_initstruct;								// 串口配置结构体	
 NVIC_InitTypeDef NVIC_InitStructure; 								// 中断优先级配置结构体

//------------------------------ 开启GPIOB和USART3时钟------------------------------------------------//
 RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOB,  ENABLE);				// 启用 GPIOB  的时钟
 RCC_APB1PeriphClockCmd(RCC_APB1Periph_USART3, ENABLE); 			// 启用 USART3 的时钟

//------------------------------------ 配置 IO 参数---------------------------------------------------//
 gpio_initstruct.GPIO_Pin = GPIO_Pin_10;
 gpio_initstruct.GPIO_Speed = GPIO_Speed_50MHz;
 gpio_initstruct.GPIO_Mode = GPIO_Mode_AF_PP;						// 配置 PB10 为复用推挽输出
 GPIO_Init(GPIOB, &gpio_initstruct);

 gpio_initstruct.GPIO_Pin = GPIO_Pin_11;
 gpio_initstruct.GPIO_Mode = GPIO_Mode_IPU; 						// 配置 PB11 （上拉输入） 
 GPIO_Init(GPIOB, &gpio_initstruct);	
	
//------------------------------------ Usart3 NVIC 配置----------------------------------------------//
 NVIC_InitStructure.NVIC_IRQChannel 				 = USART3_IRQn;	// 串口3中断通道
 NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority= 2;			// 抢占优先级 2
 NVIC_InitStructure.NVIC_IRQChannelSubPriority 		 = 0;			// 子优先级 0
 NVIC_InitStructure.NVIC_IRQChannelCmd 				 = ENABLE;		// IRQ 通道使能
 NVIC_Init(&NVIC_InitStructure);									// 根据指定的参数初始化 VIC 寄存器			
	
//------------------------------------ 配置USART3参数------------------------------------------------//	
 usart_initstruct.USART_BaudRate  	= baud; 						// 波特率
 usart_initstruct.USART_WordLength 	= USART_WordLength_8b; 			// 数据位 8 位
 usart_initstruct.USART_StopBits 	= USART_StopBits_1; 			// 停止位 1 位
 usart_initstruct.USART_Parity 		= USART_Parity_No; 				// 无校验位
 usart_initstruct.USART_HardwareFlowControl = USART_HardwareFlowControl_None; // 无硬件流控
 usart_initstruct.USART_Mode = USART_Mode_Rx | USART_Mode_Tx; 		// 收发模式
 USART_Init(USART3, &usart_initstruct);								// 初始化 USART3
 USART_Cmd(USART3, ENABLE);											// 启用 USART3

 USART_ITConfig (USART3, USART_IT_RXNE, ENABLE);					// 开启串口3接收中断 
}

/*******************************************************************************************************
                                             串口发送一个字节
*******************************************************************************************************/ 
void UARTX_Send_Byte(USART_TypeDef* USARTx, u8 byte)        
{
 USART_SendData(USARTx,byte);									//发送一字节
 while(USART_GetFlagStatus(USARTx,USART_FLAG_TC) != SET); 		//发送完成标志
}

/*******************************************************************************************************
                                               发送字符串
*******************************************************************************************************/ 
void USARTX_Sens_Str (USART_TypeDef* USARTx, unsigned char *s)
{u8 i=0;
 while (s [i] != '\0')
       {
        USART_SendData (USARTx,s [i]);
        while (USART_GetFlagStatus (USARTx,USART_FLAG_TC) != SET);
        i++;
       }
}	

/*******************************************************************************************************
                                               发送数组
*******************************************************************************************************/ 
void USARTX_Sens_Array (USART_TypeDef* USARTx, u8 array [],u8 num)
{u8 i=0;
 while (i<num)
       {
        USART_SendData (USARTx,array [i]);
        while (USART_GetFlagStatus (USARTx,USART_FLAG_TC) != SET);
        i++;
       }
}
