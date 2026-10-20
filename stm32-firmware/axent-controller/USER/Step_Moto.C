#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"


/****************************************    步进电机变量     ******************************************/

DJ_st dj1 = {0, STOP, OPEN, DJ_angle0};						//摆叶1 的结构体变量

uint8_t DJ_init_flag  = 1;									//电机1 初始化标志位

uint8_t dj_sw_en = 1;										//电机1切换方向使能
uint8_t DJ_temp_dir = 0;						//临时1方向变量
uint8_t dj_d_status = 0;						//电机1最新状态  //如果最新的状态和当前的状态不一样 则说明 需要改变摆叶状态
uint8_t dj_status   = 0;						//电机1当前状态

uint8_t cnt_speed  = 0;							//自动摆叶1 速度调节
uint8_t dj_bc_en  = 0;											//摆叶1补偿
uint8_t dj_auto_en   = 0;   							//自动摆叶1 使能

uint8_t Step_Moto_flag = 0;					//步进电机标志位							 
/******************************************************************************************************/
#if(BYXDK == 1)												//摆叶先打开
uint8_t dj_cf_en  = 0;											//打开到一定角度才能使能吹风  初始化时-不使能
#else
uint8_t dj_cf_en  = 1;											//打开到一定角度才能使能吹风  初始化时-使能
#endif

/******************************************************************************************************/




/******************************************************************************************************/





/******************************************************************************************************/
//                                         步进电机端口初始化		
/******************************************************************************************************/
void Setp_Moto_Pin_Init(void)
{
 CHENG1_L;
 HUANG1_L;
 FEN1_L;
 LAN1_L;	
}

/*******************************************************************************************************
                                         步进电机1 运行
																					 
   dj->dir 10 时 0--7  20时 7--0 这个是固定的
   至于0-7 时 角度减小还是变大 则由顺时针还是逆时针决定
   暂定 0--7 角度+ 顺时针  角度--逆时针
*******************************************************************************************************/
void DJ1_Run(DJ_st *p_dj1)
{
 if (((p_dj1->dj_dir) == 0X20) || ((p_dj1->dj_dir) == 0X10))	//摆叶 关闭 或 打开
	{
	 switch (p_dj1->dj_step)									//电机步数
		    {
			 case 0: FEN1_H;  HUANG1_L;  CHENG1_L;  LAN1_H;
					 break;
			 case 1: FEN1_L;  HUANG1_L;  CHENG1_L;  LAN1_H;
					 break;
			 case 2: FEN1_L;  HUANG1_L;  CHENG1_H;	LAN1_H;
					 break;
			 case 3: FEN1_L;  HUANG1_L;  CHENG1_H;	LAN1_L;
					 break;
			 case 4: FEN1_L;  HUANG1_H;	 CHENG1_H;	LAN1_L;
					 break;
			 case 5: FEN1_L;  HUANG1_H;	 CHENG1_L;	LAN1_L;
					 break;
			 case 6: FEN1_H;  HUANG1_H;  CHENG1_L;  LAN1_L;
					 break;
			 case 7: FEN1_H;  HUANG1_L;  CHENG1_L;  LAN1_L;
					 break;
			 default: FEN1_L; HUANG1_L;  CHENG1_L;  LAN1_L;
					 break;
		    }
	}
/*----------------------------------------------------------------------------------------------------*/		
//		顺时针BYDJ_TYPE_S：0X10：打开  则角度增加   	//逆时针BYDJ_TYPE_N：0X10：关闭  则角度减少
/*----------------------------------------------------------------------------------------------------*/
 if ((p_dj1->dj_dir) == 0X10)
    {
	 if (p_dj1->dj_step == 7)
		{
		 dj_sw_en = 1;								//摆叶切换状态使能 = 1
		 #if (BYDJ_TYPE == BYDJ_TYPE_S) 			//顺时针
			  p_dj1->dj_c_angle++;					//电机当前角度
		 #else
			  p_dj1->dj_c_angle--;					//电机当前角度
		 #endif
		}
	 else
		{
		 dj_sw_en=0;								//摆叶切换状态使能 = 0
		}
													//0-7
	 if (p_dj1->dj_step < 7)
		{
		 p_dj1->dj_step++;
		}
	 else
	    {p_dj1->dj_step = 0;
		}
	}

/*----------------------------------------------------------------------------------------------------*/
//	顺时针BYDJ_TYPE_S：0X20：关闭  则角度减少    	//逆时针BYDJ_TYPE_N：0X20：打开  则角度增加
/*----------------------------------------------------------------------------------------------------*/
 else if ((p_dj1->dj_dir) == 0X20)
	{
	 if (p_dj1->dj_step == 0)
	    {
		 dj_sw_en = 1;								//摆叶切换状态使能 = 1
		 #if (BYDJ_TYPE == BYDJ_TYPE_S)  			//顺时针
		 	  p_dj1->dj_c_angle--;					//电机当前角度
		 #else
			  p_dj1->dj_c_angle++;					//电机当前角度
		 #endif
	    }
	 else
		{
		 dj_sw_en = 0;								//摆叶切换状态使能 = 0
		}
													//7-0
	 if ((p_dj1->dj_step > 0) && (p_dj1->dj_step <= 7))
		{
		 p_dj1->dj_step--;
		}
	 else
	    {
		 p_dj1->dj_step=7;
		}
	}
				 
/*----------------------------------------------------------------------------------------------------*/
//                                         停止
/*----------------------------------------------------------------------------------------------------*/				 
 else if ((p_dj1->dj_dir) == 0X30)					//停止
	{
	 dj_sw_en = 1;									//摆叶切换状态使能 = 1
     FEN1_L;  HUANG1_L;  CHENG1_L;  LAN1_L;
	}
}

/*******************************************************************************************************
                                        [电机1] 运行的主程序

*******************************************************************************************************/
void DJ1_Function(void)
{
 if (DJ_init_flag == 1)								//电机初始化----------------------------------
	{
	 if (dj_bc_en == 0)								//[摆叶]==[不补偿]
	    {
	     if (dj1.dj_c_angle > 0)					//[电机] 当前角度 > 0  
		    {  
		     dj1.dj_dir = CLOSE;					//[方向]
		    }
		 else if (dj1.dj_c_angle == 0)				//[电机] 当前角度 == 0
		    {
			 dj1.dj_dir = STOP;						//[停止]
			 dj_bc_en = 1;							//[复位到位] --> 开始摆叶补偿
		    }
		}
	  else 											//[摆叶]===[补偿]
		{
	     if (dj1.dj_c_angle < DJ_angle4)			//即复位后回正一定角度  不需要补偿则为0
			{
			 dj1.dj_dir = OPEN;						//[方向]
			}
		 else if (dj1.dj_c_angle == DJ_angle4)		//[电机] 当前角度 == 补偿角度
			{
			 dj1.dj_dir = STOP;						//[停止]
			 dj1.dj_c_angle = 0;					//重新定义起始位置
			 dj_bc_en = 0;							//摆叶补偿 完毕
			 DJ_init_flag = 0;						//初始化标志位清零
			 //dj_d_status = 5;						//???
			 //dj_auto_en = 1;						//???
			}
		}
	}
 else												//电机初始化结束--------------------------------
	{
	 if ((dj_status != dj_d_status) && (dj_sw_en == 1))	//步进电机运行状态机 && 电机1切换方向使能
		{
		 dj_status = dj_d_status;					//电机运行状态 = 电机最新状态
		}
				
	 switch (dj_status)
		    {
		     case 0x07:	//----------------------------------------------------------------------------------
			            if (dj1.dj_c_angle < DJ_angle6)				//[摆叶] < DJ_angle6 的角度
			               {
				            dj1.dj_dir = OPEN;						//方向open
				            dj_auto_en = 0;							//自动摆叶1 使能=0
			               }
			            else if (dj1.dj_c_angle > DJ_angle6)		//[摆叶] > DJ_angle6 的角度
			               {
				            dj1.dj_dir = CLOSE;						//方向close
				            dj_auto_en = 0;							//自动摆叶1 使能=0
			               }
			            else if (dj1.dj_c_angle == DJ_angle6)		//[摆叶] == DJ_angle6 的角度  已到位
			               {
				            dj1.dj_dir = STOP;						//方向 stop
				            dj_auto_en = 0;							//自动摆叶1 使能=0
			               }
													 
                        #if (BYXDK == 1)							//摆叶先打开
			                 if (dj1.dj_c_angle >= DJ_angle1)		//当前角度 >= DJ_angle1 角度
			                    {
				                 dj_cf_en = 1;						//电机吹风使能
			                    }
                        #endif
			                  dj1.dj_dir_temp = OPEN;				//方向记录
			            break;

		     case 0x06: //----------------------------------------------------------------------------------
		     case 0x01:																					
			            if (dj1.dj_c_angle < DJ_angle1)				//[摆叶] < DJ_angle1 的角度
			               {
				            dj1.dj_dir = OPEN;						//方向open
				            dj_auto_en = 0;							//自动摆叶1 使能=0
			               }
			            else if (dj1.dj_c_angle > DJ_angle1)		//[摆叶] > DJ_angle1 的角度
			               {
				            dj1.dj_dir = CLOSE;						//方向close
				            dj_auto_en = 0;							//自动摆叶1 使能=0
			               }
			            else if (dj1.dj_c_angle == DJ_angle1)		//[摆叶] = DJ_angle1 的角度
			               {
				            dj1.dj_dir = STOP;						//方向 stop
							dj_auto_en = 1;							//自动摆叶1 使能=1
			               }
													 
                        #if (BYXDK == 1)							//摆叶先打开
			                 if (dj1.dj_c_angle >= DJ_angle1)		//当前角度 >= DJ_angle1 角度
			                    {
				                 dj_cf_en = 1;						//电机吹风使能
			                    }
                        #endif
			                 dj1.dj_dir_temp = OPEN;				//方向记录
			            break;
															 
		     case 0x00: //---------------------------------------------------------------------------------- //摆叶关闭
			            if (dj1.dj_c_angle > 0)						//当前角度 > 0 
			               {
				            dj1.dj_dir = CLOSE;						//方向 close
				            dj_auto_en = 0;							//自动摆叶1 使能=0
			               }
			            else if (dj1.dj_c_angle == 0)				//当前角度 = 0
			               {
				            dj1.dj_dir = STOP;						//方向 stop
				            dj_auto_en = 0;							//自动摆叶1 使能=0
			               }
													 
                        #if (BYXDK == 1)							//摆叶先打开
			                 if (dj1.dj_c_angle < DJ_angle1)		//当前角度 < DJ_angle1 角度
			                    {
				                 dj_cf_en = 0;						//电机吹风不使能
			                    }
                        #endif
			                  dj1.dj_dir_temp = OPEN;				//方向记录
			            break;
			
		     case 0x02: //---------------------------------------------------------------------------------- //自动摆叶
 		                if (dj_auto_en ==1)
 						   {
							if (dj1.dj_dir == STOP)					//方向 stop
							   {
								dj1.dj_dir = dj1.dj_dir_temp;		//从方向记录中读取
							   }
							else if (dj1.dj_c_angle >= DJ_angle3)	//当前角度 >= DJ_angle3 角度
							   {
								dj1.dj_dir = CLOSE;					//方向 close
							   }
							else if (dj1.dj_c_angle <= DJ_angle2)	//当前角度 <= DJ_angle2 角度
								 {
								  dj1.dj_dir = OPEN;				//方向 open
								 }
							#if (BYXDK == 1) 						//摆叶先打开
								 if (dj1.dj_c_angle >= DJ_angle1)	//当前角度 >= DJ_angle1 角度
									{
									 dj_cf_en = 1; 					//电机吹风使能
									}
							#endif
							dj1.dj_dir_temp = dj1.dj_dir;			//方向记录到临时方向中
						   }
			            else  										//摆叶开
			               {
							if (dj1.dj_c_angle < DJ_angle1)			//当前角度 < DJ_angle1 角度	
							   {
								dj1.dj_dir = OPEN;					//方向 open
								dj_auto_en = 0;						//自动摆叶1 使能=0
							   }
							else if (dj1.dj_c_angle > DJ_angle1)	//当前角度 > DJ_angle1 角度
							   {
								dj1.dj_dir = CLOSE;					//方向 close
								dj_auto_en = 0;						//自动摆叶1 使能=0
							   }
							else if (dj1.dj_c_angle == DJ_angle1)	//当前角度 = DJ_angle1 角度
							   {
								dj1.dj_dir = STOP;					//方向 close
								dj_auto_en = 1;						//自动摆叶1 使能=1
							   }
					    #if (BYXDK == 1) 							//摆叶先打开
							 if (dj1.dj_c_angle >= DJ_angle1)		//当前角度 >= DJ_angle1 角度
								{
								 dj_cf_en = 1;						//电机吹风使能
								}
					    #endif
							 dj1.dj_dir_temp = OPEN;				//方向记录
			               }
			            break;
			
		     case 0x05: //---------------------------------------------------------------------------------- //固定摆叶
                        #if (BYXDK == 1)							//摆叶先打开
							 if (dj_cf_en == 0)						//电机吹风使能 = 0
							    {
								 dj1.dj_dir = OPEN;					//如果固定前 还没到摆叶先开的角度 则打开后才能固定
								 dj_auto_en = 0;					//自动摆叶1 使能=0
							    }
							 else									//电机吹风使能 = 1
							    {
								 dj1.dj_dir = STOP;					//方向 stop
								 dj_auto_en = 0;					//自动摆叶1 使能=0
							    }
														 
							 if (dj1.dj_c_angle >= DJ_angle1)		//当前角度 >= DJ_angle1 角度
							    {
								 dj_cf_en = 1;						//电机吹风使能
							    }
                        #else
			                 dj1.dj_dir = STOP;						//[电机] == 停止
                        #endif
			            break;
			
		     default:
			            break;
		    }
	}
		
/*---------------------------------------------------------------------------------------------------------------*/		
 if (dj1.dj_dir != DJ_temp_dir)										//电机方向 不等于 电机临时方向
	{
	 DJ_temp_dir = dj1.dj_dir;										//电机临时方向 = 电机方向
		 
	 if (dj1.dj_dir == CLOSE)										//电机方向 = close
		{
		 #if (BYDJ_TYPE == BYDJ_TYPE_S)								//顺时针 时 CLOSE：0X20 是7---0  7---0这样循环
			  dj1.dj_step = 7;										//电机步数 = 7
		 #else														//逆时针 时 CLOSE：0X10 是0---7  0---7这样循环
			  dj1.dj_step = 0;										//电机步数 = 0
		 #endif
		}
	  else if(dj1.dj_dir == OPEN)									//电机方向 = close
		{
		 #if (BYDJ_TYPE == BYDJ_TYPE_S) 							//顺时针 时 OPEN：0X10 是0---7  0---7这样循环
			  dj1.dj_step = 0;										//电机步数 = 0
		 #else 														//逆时针 时 OPEN：0X20 是7---0  7---0这样循环
			  dj1.dj_step = 7;										//电机步数 = 7
		 #endif
		}
	}

/*---------------------------------------------------------------------------------------------------------------*/
 if (dj_status == 0x02 && dj_cf_en == 1) 							//自动摆叶状态
	{
	 cnt_speed++;													//自动摆叶1 速度调节
	 if (cnt_speed >= BY_SPEED)										//==自动摆叶速度 默认1  单位是5ms
	    {
		 cnt_speed = 0;												//自动摆叶1 速度调节 = 0
		 DJ1_Run(&dj1);												//【步进电机运行】	
		}
	}
 else
	{
	 DJ1_Run(&dj1);													//【步进电机运行】
	}
}




/**********************************************************************************/
//                              步进电机运行  
/**********************************************************************************/
void Running_Step_Moto(void)
{
 if (Step_Moto_flag == 1)								//步进电机标志位							 
    {Step_Moto_flag = 0;
     DJ1_Function();									//[电机1] 运行的主程序								

	}
}
/******************************************************************************************************/




