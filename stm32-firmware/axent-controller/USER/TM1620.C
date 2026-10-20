#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"

/******************************************************************************************************/
#define dissetmode        0x02    	//显示模式设置 六位八段显示
#define writedatamode_z   0x40    	//自动加一方式显存 写数据到显示寄存器
#define writeledmode_z    0x41    	//自动加一方式写LED显存命令
#define readkeymode       0x42    	//读按键命令
#define readswmode        0x43    	//读SW命令
#define writedatamode_g   0x44    	//固定模式
#define writeledmote_g    0x45    	//固定模式写LED显存命令
#define startaddress      0xc0    	//起始地址自动加1显示的起始地址设置，为00H
#define disconmode        0x8f    	//显示控制，显示开

/******************************************************************************************************/
typedef struct {
				unsigned int ZaoMin    		:1;		//照明
				unsigned int HuanQi  		:1;		//换气
				unsigned int CuiFen  		:1;		//吹风
	            unsigned int W_Warm	        :1;		//弱暖
	            unsigned int S_Warm	        :1;		//强暖
				unsigned int BaiYei  		:2;		//摆叶 0关闭 1打开 2停止 3自动
				unsigned int CuShi			:1;		//除湿
				unsigned int Power1 	  	:1;		//待机	
	  			unsigned int Sub_CuiFen  	:1;		//辅助吹风
               }str0;
extern str0 Stat;


uint8_t disp[12];					//TM1620显存		

const uint8_t  Seg[30]={ 
						0x3F,  //"0"
						0x06,  //"1"
						0x5B,  //"2"
						0x4F,  //"3"
						0x66,  //"4"
						0x6D,  //"5"
						0x7D,  //"6"
						0x07,  //"7"
						0x7F,  //"8"
						0x6F,  //"9"
						0x77,  //"A"
						0x7C,  //"B"
						0x39,  //"C"
						0x5E,  //"D"
						0x79,  //"E"
						0x71,  //"F"
						0x76,  //"H"
						0x38,  //"L"
						0x37,  //"n"
						0x3E,  //"u"
						0x73,  //"P"
						0x5C,  //"o"
						0x40,  //"-"
						0x00,  //熄灭
						0x00   //自定义
                       };

uint8_t disp_reg;					//数码管显存
uint8_t WenDu;						//温度						   
extern uint8_t Warm_Delay_15S;		//取暖延时	
extern uint8_t Rst_Net;				//重置 WIFI， 进入配网模式 0x0A
extern uint8_t Net_Pop_Flag;		//配网闪烁 标志位						   
extern uint8_t Net_delay;			//配网1分种计时					   
extern uint8_t delay_1_Minute;		//上电 1分钟配网延时
extern uint8_t En_Net_Flag;			//联网使能
					   
/*******************************************************************************************************
                                        TM1620写数据                  
*******************************************************************************************************/   
void TM1620_indate(uint8_t data0)
{uint8_t i;
 TM1620_STB_Low;			

 for (i=0; i<8; i++)
     {TM1620_CLK_Low;				//CLK=0;
	  if ((data0&0x01) != 0)
		 {TM1620_DIN_High;}
	  else
		 {TM1620_DIN_Low;}
	  TM1620_CLK_High;				//CLK=1;
	  data0 = data0>>1;
     }
}

/*******************************************************************************************************
                                  TM1620控制指令 相应的显示 
*******************************************************************************************************/ 
void TM1620_Display(void)
{uint8_t i,tmp1,tmp0;				
 uint8_t color;
	
 TM1620_STB_High;							//初始化
 TM1620_CLK_High;
 TM1620_DIN_High;	
	
 WenDu = Conver_Temper();					//读取温度

/*--------------------------------------------------------------------------------------------------*/
 if (delay_1_Minute != 0) 					//上电 1分钟配网延时					
    {
	 if (Net_Pop_Flag == 0)					//配网闪烁 标志位 500mS		
	    {color = Purple;					//紫色
		}
	 else
	    {color = Black;						//黑色
		}		 
	} 
 else
    {
	 if (Net_delay != 0)						//配网1分种计时					   	
		{
		 if (Rst_Net == 0x0A)					//重置 WIFI， 进入配网模式 0x0A
			{
			 if (Net_Pop_Flag == 0)				//配网闪烁 标志位 500mS						   	
				{color = White;					//白色
				}
			 else
				{color = Black;					//黑色
				}		 
			}	
		}
	 else
		{if (En_Net_Flag == 1)					//配网使能 = 1
			{color = Orange;					//黄色 APP可控	
			}
		 else									//配网使能 = 0
			{color = White;						//白色 APP不可控	
			}		 
		}	 		
	}	 
/*--------------------------------------------------------------------------------------------------*/
 if (Warm_Delay_15S == 0)	
    {disp_reg = WenDu;						//温度 --> 数码管显存		

//	 if (Stat.S_Warm == 1)					//强暖 显示 红色
//	    {color = Red;	
//		}		 
//	 else if (Stat.W_Warm == 1)				//
//	    {color = Orange;
//	    }		 
//	 else if (Stat.CuiFen == 1)
//	    {color = Blue;
//		}
//	 else if (Stat.HuanQi==1)	
//	    {color = Green;
//		} 
//	 else
//	    {color = White;
//		}		 
	} 
 else 
    {disp_reg = Warm_Delay_15S;				//倒计时 --> 数码管显存		
	 color = Cyan;							//青色
	}	

/*--------------------------------------------------------------------------------------------------*/
 tmp1 = ((disp_reg / 10) % 10);				//十位
 tmp0 = (disp_reg % 10);					//十位
/*--------------------------------------------------------------------------------------------------*/
 for (i=0; i<12; i++) {disp[i] = 0;}		//消隐
/*--------------------------------------------------------------------------------------------------*/
 // [0]    0 1 2 3 4 5 6 7            [1]    0 1 2 3 4 5 6 7	绿  十位
 //        A B C D E F * *                   G * * * * * * * 
 // [2]    0 1 2 3 4 5 6 7            [3]    0 1 2 3 4 5 6 7	红  十位 
 //        A B C D E F * *                   G * * * * * * * 
 // [4]    0 1 2 3 4 5 6 7            [5]    0 1 2 3 4 5 6 7	蓝  十位 
 //        A B C D E F * *                   G * * * * * * * 
 
 // [6]    0 1 2 3 4 5 6 7            [7]    0 1 2 3 4 5 6 7	绿  个位 
 //        A B C D E F * *                   G * * * * * * *  
 // [8]    0 1 2 3 4 5 6 7            [9]    0 1 2 3 4 5 6 7	红  个位  
 //        A B C D E F * *                   G * * * * * * * 
 // [10]   0 1 2 3 4 5 6 7            [11]   0 1 2 3 4 5 6 7	蓝  个位  
 //        A B C D E F * *                   G * * * * * * *  
/*--------------------------------------------------------------------------------------------------*/
 if (color == White)									//【白色】   
    {disp[2] = Seg[tmp1];								//R
	 disp[3] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//R
     disp[8] = Seg[tmp0];								//R	
	 disp[9] = ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//R	
		
     disp[0] = Seg[tmp1];								//G
	 disp[1] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//G
     disp[6] = Seg[tmp0];								//G
	 disp[7] = ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//G
		
     disp[4] = Seg[tmp1];								//B			
	 disp[5] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//B
     disp[10]= Seg[tmp0];								//B
	 disp[11]= ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//B	
	}
 else if (color == Red)	 								//【红色】 [2][3]-[8][9]
    {disp[2] = Seg[tmp1];								//R
	 disp[3] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//R
     disp[8] = Seg[tmp0];								//R
	 disp[9] = ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//R
	}
 else if (color == Green)	 							//【绿色】 [0][1]-[6][7]
    {disp[0] = Seg[tmp1];								//G
	 disp[1] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//G
     disp[6] = Seg[tmp0];								//G
	 disp[7] = ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//G
	}
 else if (color == Blue)	 							//【蓝色】 [4][5]-[10][11]
    {disp[4] = Seg[tmp1];								//B	
	 disp[5] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//B
     disp[10]= Seg[tmp0];								//B
	 disp[11]= ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//B
	}	
 else if (color == Orange)								//【橙色】红+绿
    {disp[2] = Seg[tmp1];								//R
	 disp[3] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//R
     disp[8] = Seg[tmp0];								//R	
	 disp[9] = ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//R

     disp[0] = Seg[tmp1];								//G
	 disp[1] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//G
     disp[6] = Seg[tmp0];								//G
	 disp[7] = ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//G	
	} 
 else if (color == Cyan)								//【青色】绿+蓝	
    {disp[0] = Seg[tmp1];								//G
	 disp[1] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//G
     disp[6] = Seg[tmp0];								//G
	 disp[7] = ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//G
		
	 disp[4] = Seg[tmp1];								//B
	 disp[5] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//B
     disp[10]= Seg[tmp0];								//B
	 disp[11]= ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//B
	} 
 else if (color == Purple)	 							//【紫色】红+蓝
    {disp[2] = Seg[tmp1];								//R
	 disp[3] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//R
     disp[8] = Seg[tmp0];								//R
	 disp[9] = ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//R
	
	 disp[4] = Seg[tmp1];								//B
	 disp[5] = ((Seg[tmp1]&0x40)==0x40)?0xff:0x00;		//B
     disp[10]= Seg[tmp0];								//B	
	 disp[11]= ((Seg[tmp0]&0x40)==0x40)?0xff:0x00;		//B
	} 
 else if (color == Black)	 							//【黑色】
    {disp[2] = 0;
	 disp[3] = 0;
     disp[8] = 0;
	 disp[9] = 0;
	
	 disp[4] = 0;
	 disp[5] = 0;
     disp[10]= 0;
	 disp[11]= 0;
	} 	 
	
/*--------------------------------------------------------------------------------------------------*/
 TM1620_indate(dissetmode);					//设置显示模式02 【六位八段显示】
 TM1620_STB_High;
	
 TM1620_indate(writedatamode_g);			//固定模式
 TM1620_STB_High;
	
 for (i=0; i<12; i++)
	 {
	  TM1620_indate(startaddress + i); 		//传起始地址

	  TM1620_indate(disp[i]);    			//传数据
	  TM1620_STB_High;
     }
	 
 TM1620_indate(disconmode);     			//显示控制，显示开
 TM1620_STB_High;
}

/******************************************************************************************************/
