import moment from'moment-timezone';


const  isExpired = ( expiryDate ) => {
  const now = moment().tz('GMT').format();
 
  console.log(now);
  console.log(expiryDate);
  
  
  
  return now > expiryDate;
  
}


export default isExpired; 