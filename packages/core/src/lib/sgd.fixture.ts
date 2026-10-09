/** Lines of a `getvar "allcv"` answer, measured on a ZD230 with firmware V89.21.46Z.
 *  The group headers, empty values and colon-carrying values are deliberate parser cases. */
export const ZD230_ALLCV_EXCERPT = `bluetooth.
bluetooth.version :
bluetooth.clear_bonding_cache
card.mac_addr : 00:00:00:00:00:00
head.
head.resolution.
head.resolution.in_dpi : 203
media.sense_mode : gap , Choices: bar,gap
media.type : label , Choices: label,journal
media.printmode : tear off , Choices: tear off,peel off,rewind,cutter,delayed cut,linerless cut,linrless dly cut,linerless peel,linerless tear,applicator,stream
media.speed : 6.0 , Choices: 4.0-6.0
media.thermal_mode : DT , Choices: DT
media.backfeed : N , Choices: N,A,O,B,10,20,30,40,50,60,70,80
device.friendly_name : D4J260700032
device.languages : epl_zpl , Choices: hybrid_xml_zpl,epl_zpl,epl,zpl
print.tone : 15.0 , Choices: 0.0-30.0
print.invert_label : off , Choices: on,off
zpl.relative_darkness : 0 , Choices: -300-300
zpl.label_length : 1219 , Choices: 1-32000
zpl.label_length_always : yes , Choices: yes,no
zpl.left_position : 0 , Choices: -9999-9999
zpl.format_prefix : ^ (5E) , Choices: 00-FF,00-ff
zpl.command_prefix : ~ (7E) , Choices: 00-FF,00-ff
zpl.delimiter : , (2C) , Choices: 00-FF,00-ff
zpl.zpl_mode : zpl II , Choices: zpl II,zpl
zpl.print_orientation : nor , Choices: nor,inv
zpl.label_top : 30 , Choices: -120-120
ezpl.print_width : 813 , Choices: 2-832
ezpl.media_type : gap/notch , Choices: auto_detect,continuous,gap/notch,mark
ezpl.print_method : direct thermal , Choices: direct thermal
ezpl.tear_off : 0 , Choices: -120-120
ezpl.print_mode : tear off , Choices: tear off,peel off,rewind,cutter,delayed cut,linerless cut,linrless dly cut,linerless peel,linerless tear,applicator,stream
ezpl.reprint_mode : off , Choices: on,off
ezpl.head_close_action : feed , Choices: calibrate,feed,length,no motion,short cal,quick cal
ezpl.power_up_action : no motion , Choices: calibrate,feed,length,no motion,short cal,quick cal
`;
